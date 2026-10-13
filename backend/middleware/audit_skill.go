package middleware

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"strings"

	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/aiguard"
	"github.com/chaitin/MonkeyCode/backend/pkg/auditmeta"
)

const (
	maxAuditMultipartFieldBytes = 4096
	maxAuditStringBytes         = 512
)

func isSkillAuditOperation(operation string) bool {
	switch operation {
	case "add_team_skill", "add_team_skill_package", "update_team_skill", "import_team_extension_package":
		return true
	default:
		return false
	}
}

// summarizeSkillAudit intentionally never returns the request body or complete
// response. JSON Skill content is represented by length/hash only, while
// multipart file parts are streamed into a hash and never persisted.
func summarizeSkillAudit(
	operation string,
	contentType string,
	body []byte,
	responseBody string,
	status int,
	skillID string,
	handlerErr error,
	guardResult auditmeta.GuardResult,
) (string, string, error) {
	requestSummary, err := summarizeSkillRequest(operation, contentType, body)
	if err != nil {
		return "", "", err
	}
	if skillID != "" {
		requestSummary["skill_id"] = truncateString(skillID, maxAuditStringBytes)
	}
	requestJSON, err := json.Marshal(requestSummary)
	if err != nil {
		return "", "", err
	}

	responseSummary := map[string]any{
		"success":     handlerErr == nil,
		"http_status": status,
	}
	if guardResult.TaskID != "" || guardResult.Status != "" || guardResult.DetectionResult != "" || guardResult.TraceID != "" {
		responseSummary["guard"] = map[string]any{
			"task_id":          truncateString(guardResult.TaskID, maxAuditStringBytes),
			"status":           truncateString(guardResult.Status, maxAuditStringBytes),
			"detection_result": truncateString(guardResult.DetectionResult, maxAuditStringBytes),
			"trace_id":         truncateString(guardResult.TraceID, maxAuditStringBytes),
		}
	}
	if handlerErr != nil {
		responseSummary["error"] = summarizeAuditError(handlerErr)
	} else {
		responseSummary["response_bytes"] = len(responseBody)
		addTopLevelResponseFields(responseSummary, responseBody)
	}
	responseJSON, err := json.Marshal(responseSummary)
	if err != nil {
		return "", "", err
	}
	return string(requestJSON), string(responseJSON), nil
}

func summarizeSkillRequest(operation, contentType string, body []byte) (map[string]any, error) {
	summary := map[string]any{
		"format":      "redacted",
		"operation":   operation,
		"body_bytes":  len(body),
		"body_sha256": hashBytes(body),
	}
	if len(body) == 0 {
		return summary, nil
	}

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		summary["parse_error"] = "invalid_content_type"
		return summary, nil
	}
	switch strings.ToLower(mediaType) {
	case "application/json":
		summary["format"] = "json"
		var raw map[string]any
		if err := json.Unmarshal(body, &raw); err != nil {
			summary["parse_error"] = "invalid_json"
			return summary, nil
		}
		summarizeJSONSkillRequest(summary, raw)
	case "multipart/form-data":
		summary["format"] = "multipart"
		if params["boundary"] == "" {
			summary["parse_error"] = "missing_multipart_boundary"
			return summary, nil
		}
		if err := summarizeMultipartSkillRequest(summary, body, params["boundary"]); err != nil {
			summary["parse_error"] = "invalid_multipart"
		}
	default:
		// Unknown content types are fail-closed too: only the body digest above
		// is retained, never the body itself.
	}
	return summary, nil
}

func summarizeJSONSkillRequest(summary, raw map[string]any) {
	copyStringField(summary, raw, "name")
	copyStringField(summary, raw, "source_type")
	copyStringField(summary, raw, "source_label")
	copyStringField(summary, raw, "skill_md_path")
	copyBoolField(summary, raw, "is_force_delivery")
	copyCollectionCount(summary, raw, "tags", "tags_count")
	copyCollectionCount(summary, raw, "group_ids", "group_ids_count")
	summarizeJSONString(summary, raw, "content", "content")
}

func summarizeMultipartSkillRequest(summary map[string]any, body []byte, boundary string) error {
	reader := multipart.NewReader(bytes.NewReader(body), boundary)
	files := make([]map[string]any, 0, 1)
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		fieldName := normalizeAuditFieldName(part.FormName())
		filename := sanitizeFilename(part.FileName())
		if filename != "" {
			size, digest, err := digestReader(part)
			_ = part.Close()
			if err != nil {
				return err
			}
			files = append(files, map[string]any{
				"field":    truncateString(fieldName, maxAuditStringBytes),
				"filename": truncateString(filename, maxAuditStringBytes),
				"size":     size,
				"sha256":   digest,
			})
			continue
		}

		if fieldName == "content" {
			size, digest, err := digestReader(part)
			_ = part.Close()
			if err != nil {
				return err
			}
			summary["content_bytes"] = size
			summary["content_sha256"] = digest
			continue
		}
		if isAllowedMultipartSummaryField(fieldName) {
			value, truncated, err := readBoundedString(part, maxAuditMultipartFieldBytes)
			_ = part.Close()
			if err != nil {
				return err
			}
			if truncated {
				value = "[truncated]"
			}
			summary[fieldName] = value
			continue
		}
		// Discard non-allowlisted fields without copying them into memory.
		_, _ = io.Copy(io.Discard, part)
		_ = part.Close()
	}
	if len(files) > 0 {
		summary["files"] = files
	}
	return nil
}

func summarizeJSONString(summary, raw map[string]any, field, prefix string) {
	value, ok := raw[field].(string)
	if !ok {
		return
	}
	summary[prefix+"_bytes"] = len(value)
	summary[prefix+"_sha256"] = hashBytes([]byte(value))
}

func copyStringField(summary, raw map[string]any, field string) {
	value, ok := raw[field].(string)
	if !ok || strings.TrimSpace(value) == "" {
		return
	}
	summary[field] = truncateString(value, maxAuditStringBytes)
}

func copyBoolField(summary, raw map[string]any, field string) {
	value, ok := raw[field].(bool)
	if ok {
		summary[field] = value
	}
}

func copyCollectionCount(summary, raw map[string]any, field, target string) {
	value, ok := raw[field].([]any)
	if ok {
		summary[target] = len(value)
	}
}

func isAllowedMultipartSummaryField(field string) bool {
	switch field {
	case "name", "source_type", "source_label", "skill_md_path":
		return true
	default:
		return false
	}
}

func normalizeAuditFieldName(field string) string {
	return strings.ToLower(strings.TrimSpace(field))
}

func sanitizeFilename(filename string) string {
	filename = strings.TrimSpace(filename)
	filename = strings.ReplaceAll(filename, "/", "_")
	filename = strings.ReplaceAll(filename, "\\", "_")
	return truncateString(filename, maxAuditStringBytes)
}

func readBoundedString(reader io.Reader, limit int64) (string, bool, error) {
	raw, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return "", false, err
	}
	if int64(len(raw)) > limit {
		return string(raw[:limit]), true, nil
	}
	return string(raw), false, nil
}

func digestReader(reader io.Reader) (int64, string, error) {
	hash := sha256.New()
	size, err := io.Copy(hash, reader)
	if err != nil {
		return 0, "", err
	}
	return size, hex.EncodeToString(hash.Sum(nil)), nil
}

func hashBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func addTopLevelResponseFields(summary map[string]any, responseBody string) {
	if responseBody == "" {
		return
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(responseBody), &raw); err != nil {
		return
	}
	for _, field := range []string{"code", "msg", "message"} {
		value, ok := raw[field]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case string:
			summary[field] = truncateString(typed, maxAuditStringBytes)
		case float64:
			summary[field] = int64(typed)
		}
	}
}

func summarizeAuditError(err error) map[string]any {
	switch {
	case errors.Is(err, aiguard.ErrRejected):
		return map[string]any{"code": "guard_rejected", "message": "skill package rejected by security scan"}
	case errors.Is(err, aiguard.ErrNotConfigured):
		return map[string]any{"code": "guard_not_configured", "message": "security scan service is not configured"}
	case errors.Is(err, aiguard.ErrUnavailable):
		return map[string]any{"code": "guard_unavailable", "message": "security scan service is unavailable"}
	case errors.Is(err, errcode.ErrBadRequest):
		return map[string]any{"code": "bad_request", "message": "request validation failed"}
	default:
		return map[string]any{"code": "operation_failed", "message": "operation failed"}
	}
}

func truncateString(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return fmt.Sprintf("%s...[truncated]", value[:limit])
}
