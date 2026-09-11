// Package aiguard implements the fail-closed HTTP client for MonkeyCode's
// administrator Skill static-scan integration.
package aiguard

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

const (
	defaultRequestTimeout = 10 * time.Second
	defaultWaitTimeout    = 10 * time.Minute
	defaultPollInterval   = time.Second
)

var (
	ErrNotConfigured = errors.New("aiguard: base_url or api_token is not configured")
	ErrRejected      = errors.New("aiguard: skill package was not approved")
	ErrUnavailable   = errors.New("aiguard: scan service unavailable or returned an invalid response")
)

// Client submits one scan task per Skill package and polls only that task ID.
type Client struct {
	baseURL        string
	apiToken       string
	requestTimeout time.Duration
	waitTimeout    time.Duration
	pollInterval   time.Duration
	httpClient     *http.Client
}

// NewClient constructs a client without validating remote configuration so a
// missing deployment Secret cannot prevent the backend process from starting.
// Every Scan call remains fail-closed until configuration is present.
func NewClient(cfg config.AIGuardConfig) *Client {
	return &Client{
		baseURL:        strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"),
		apiToken:       strings.TrimSpace(cfg.APIToken),
		requestTimeout: durationOr(cfg.RequestTimeout, defaultRequestTimeout),
		waitTimeout:    durationOr(cfg.WaitTimeout, defaultWaitTimeout),
		pollInterval:   durationOr(cfg.PollInterval, defaultPollInterval),
		httpClient:     &http.Client{Timeout: durationOr(cfg.RequestTimeout, defaultRequestTimeout)},
	}
}

func durationOr(raw string, fallback time.Duration) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		return fallback
	}
	return d
}

// Scan creates exactly one task and then polls the returned task ID. It returns
// a sanitized result even when the decision is non-safe, so callers can audit
// the task ID and status without receiving the service's raw response.
func (c *Client) Scan(ctx context.Context, req domain.SkillGuardRequest) (*domain.SkillGuardResult, error) {
	if c == nil || c.baseURL == "" || c.apiToken == "" {
		return nil, ErrNotConfigured
	}
	if len(req.Package) == 0 {
		return nil, fmt.Errorf("%w: empty package", ErrUnavailable)
	}
	if req.Filename == "" {
		req.Filename = "skill-package.zip"
	}

	result, err := c.createTask(ctx, req)
	if err != nil {
		return result, err
	}
	done, err := evaluateCreateResult(result)
	if err != nil || done {
		return result, err
	}
	createdTaskID := strings.TrimSpace(result.TaskID)
	result.TaskID = createdTaskID

	timer := time.NewTimer(c.waitTimeout)
	defer timer.Stop()
	ticker := time.NewTicker(c.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return result, fmt.Errorf("%w: %v", ErrUnavailable, ctx.Err())
		case <-timer.C:
			if result == nil {
				result = &domain.SkillGuardResult{}
			}
			return result, fmt.Errorf("%w: scan task %s exceeded wait timeout", ErrUnavailable, result.TaskID)
		case <-ticker.C:
			result, err = c.getTask(ctx, createdTaskID)
			if err != nil {
				return result, err
			}
			if result == nil {
				result = &domain.SkillGuardResult{}
			}
			if strings.TrimSpace(result.TaskID) != createdTaskID {
				result.TaskID = createdTaskID
				return result, fmt.Errorf("%w: poll response task id mismatch", ErrUnavailable)
			}
			result.TaskID = createdTaskID
			done, err := evaluatePollResult(result)
			if err != nil || done {
				return result, err
			}
		}
	}
}

func evaluateCreateResult(result *domain.SkillGuardResult) (bool, error) {
	if result == nil {
		return true, fmt.Errorf("%w: create response missing task id", ErrUnavailable)
	}
	if strings.TrimSpace(result.TaskID) == "" {
		return true, fmt.Errorf("%w: create response missing task id", ErrUnavailable)
	}

	status := strings.ToLower(strings.TrimSpace(result.Status))
	switch status {
	case "":
		// AC-006 explicitly permits a create response that only contains taskId.
		result.Status = "pending"
		return false, nil
	case "pending", "running":
		return false, nil
	case "completed", "failed", "terminated":
		return true, evaluateTerminalResult(result)
	default:
		return true, fmt.Errorf("%w: create response status=%q task_id=%s", ErrUnavailable, result.Status, result.TaskID)
	}
}

func evaluatePollResult(result *domain.SkillGuardResult) (bool, error) {
	if result == nil {
		return true, fmt.Errorf("%w: empty poll response", ErrUnavailable)
	}
	if strings.TrimSpace(result.TaskID) == "" {
		return true, fmt.Errorf("%w: poll response missing task id", ErrUnavailable)
	}

	status := strings.ToLower(strings.TrimSpace(result.Status))
	switch status {
	case "pending", "running":
		return false, nil
	case "completed", "failed", "terminated":
		return true, evaluateTerminalResult(result)
	default:
		return true, fmt.Errorf("%w: poll response status=%q task_id=%s", ErrUnavailable, result.Status, result.TaskID)
	}
}

func evaluateTerminalResult(result *domain.SkillGuardResult) error {
	status := strings.ToLower(strings.TrimSpace(result.Status))
	if status == "failed" || status == "terminated" {
		return fmt.Errorf("%w: status=%q task_id=%s", ErrRejected, result.Status, result.TaskID)
	}
	if status != "completed" {
		return fmt.Errorf("%w: status=%q task_id=%s", ErrUnavailable, result.Status, result.TaskID)
	}

	switch strings.ToLower(strings.TrimSpace(result.DetectionResult)) {
	case "safe":
		return nil
	case "critical", "high", "medium", "low", "failed", "pending":
		return fmt.Errorf("%w: status=%q detection_result=%q task_id=%s",
			ErrRejected, result.Status, result.DetectionResult, result.TaskID)
	default:
		return fmt.Errorf("%w: status=%q detection_result=%q task_id=%s",
			ErrUnavailable, result.Status, result.DetectionResult, result.TaskID)
	}
}

func (c *Client) createTask(ctx context.Context, req domain.SkillGuardRequest) (*domain.SkillGuardResult, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("skillName", req.Name); err != nil {
		return nil, err
	}
	if req.Version != "" {
		if err := writer.WriteField("skillVersion", req.Version); err != nil {
			return nil, err
		}
	}
	if err := writer.WriteField("staticDetect", "true"); err != nil {
		return nil, err
	}
	if err := writer.WriteField("llmDetect", "false"); err != nil {
		return nil, err
	}
	if err := writer.WriteField("dynamicDetect", "false"); err != nil {
		return nil, err
	}
	part, err := writer.CreateFormFile("skillPackage", req.Filename)
	if err != nil {
		return nil, err
	}
	if _, err := part.Write(req.Package); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}

	httpReq, err := c.newRequest(ctx, http.MethodPost, "/api/v1/scan-tasks", &body)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", writer.FormDataContentType())
	return c.do(httpReq, "")
}

func (c *Client) getTask(ctx context.Context, taskID string) (*domain.SkillGuardResult, error) {
	httpReq, err := c.newRequest(ctx, http.MethodGet, "/api/v1/scan-tasks/"+url.PathEscape(taskID), nil)
	if err != nil {
		return nil, err
	}
	return c.do(httpReq, taskID)
}

func (c *Client) newRequest(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	httpReq, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("X-API-Token", c.apiToken)
	httpReq.Header.Set("Accept", "application/json")
	return httpReq, nil
}

func (c *Client) do(req *http.Request, fallbackTaskID string) (*domain.SkillGuardResult, error) {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, fmt.Errorf("%w: read response: %v", ErrUnavailable, err)
	}
	snapshot, decodeErr := decodeSnapshot(raw)
	if snapshot == nil {
		snapshot = &domain.SkillGuardResult{}
	}
	if snapshot.TaskID == "" {
		snapshot.TaskID = fallbackTaskID
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail := strings.TrimSpace(snapshot.TraceID)
		if decodeErr != nil || detail == "" {
			detail = http.StatusText(resp.StatusCode)
		}
		return snapshot, fmt.Errorf("%w: http %d %s", ErrUnavailable, resp.StatusCode, detail)
	}
	if decodeErr != nil {
		return snapshot, fmt.Errorf("%w: invalid json response", ErrUnavailable)
	}
	return snapshot, nil
}

func decodeSnapshot(raw []byte) (*domain.SkillGuardResult, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	if root, ok := value.(map[string]any); ok {
		if errValue := findString(root, "err"); errValue != "" {
			return &domain.SkillGuardResult{
				TaskID:          findFirstString(value, "taskId", "task_id"),
				Status:          findFirstString(value, "status"),
				DetectionResult: findFirstString(value, "detectionResult", "detection_result", "result"),
				TraceID:         findFirstString(value, "traceId", "trace_id", "requestId", "request_id"),
			}, fmt.Errorf("%w: %s", ErrUnavailable, errorSummary(root))
		}
	}
	taskID := findFirstString(value, "taskId", "task_id")
	if taskID == "" {
		// Some deployments wrap the task object and expose only id at its root.
		taskID = findString(value, "id")
	}
	return &domain.SkillGuardResult{
		TaskID:          taskID,
		Status:          findFirstString(value, "status"),
		DetectionResult: findFirstString(value, "detectionResult", "detection_result", "result"),
		TraceID:         findFirstString(value, "traceId", "trace_id", "requestId", "request_id"),
	}, nil
}

func errorSummary(root map[string]any) string {
	parts := []string{}
	if v := findString(root, "err"); v != "" {
		parts = append(parts, v)
	}
	if v := findString(root, "msg", "message"); v != "" {
		parts = append(parts, v)
	}
	return strings.Join(parts, ": ")
}

func findString(value any, names ...string) string {
	root, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	if found := findFirstString(root, names...); found != "" {
		return found
	}
	return ""
}

func findFirstString(value any, names ...string) string {
	wanted := make(map[string]struct{}, len(names))
	for _, name := range names {
		wanted[normalizeKey(name)] = struct{}{}
	}
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if _, ok := wanted[normalizeKey(key)]; ok {
				if s, ok := child.(string); ok && strings.TrimSpace(s) != "" {
					return s
				}
			}
		}
		for _, child := range typed {
			if found := findFirstString(child, names...); found != "" {
				return found
			}
		}
	case []any:
		for _, child := range typed {
			if found := findFirstString(child, names...); found != "" {
				return found
			}
		}
	}
	return ""
}

func normalizeKey(key string) string {
	key = strings.ToLower(strings.TrimSpace(key))
	key = strings.ReplaceAll(key, "_", "")
	key = strings.ReplaceAll(key, "-", "")
	return key
}
