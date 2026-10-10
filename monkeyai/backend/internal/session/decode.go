package session

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type sessionInput struct {
	StateSeq        *int64       `json:"state_seq"`
	Client          *clientInput `json:"client"`
	SessionType     *string      `json:"session_type"`
	ParentSessionID *string      `json:"parent_session_id"`
	Title           *string      `json:"title"`
	TitleSource     *string      `json:"title_source"`
	ExpertID        *string      `json:"expert_id"`
	ModelID         *string      `json:"model_id"`
	Mode            *string      `json:"mode"`
	WorkspaceKind   *string      `json:"workspace_kind"`
	StartedAt       *timeValue   `json:"started_at"`
	ClientDeletedAt *timeValue   `json:"client_deleted_at"`
}

type clientInput struct {
	Type           string `json:"type"`
	MachineID      string `json:"machine_id"`
	Version        string `json:"version"`
	EngineVersion  string `json:"engine_version"`
	RuntimeVersion string `json:"runtime_version"`
}

type timeValue struct {
	Time time.Time
}

func (v *timeValue) MarshalJSON() ([]byte, error) { return json.Marshal(v.Time) }

func (v *timeValue) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		return nil
	}
	var value time.Time
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	v.Time = value
	return nil
}

type turnBatchInput struct {
	FactsVersion      *int32          `json:"facts_version"`
	Snapshots         []snapshotInput `json:"snapshots"`
	ResourceSnapshots []snapshotInput `json:"resource_snapshots"`
	Turns             []turnInput     `json:"turns"`
	FinishedTurns     []turnInput     `json:"finished_turns"`
}

type snapshotInput struct {
	SnapshotID   string         `json:"snapshot_id"`
	Revision     *int64         `json:"revision"`
	StateVersion *int64         `json:"state_version"`
	Items        []snapshotItem `json:"items"`
}

type snapshotItem struct {
	ID         string  `json:"id"`
	ResourceID string  `json:"resource_id"`
	Kind       string  `json:"kind"`
	Name       *string `json:"name"`
	Source     *string `json:"source"`
	Version    *string `json:"version"`
	Digest     *string `json:"digest"`
	Enabled    *bool   `json:"enabled"`
	Available  *bool   `json:"available"`
	Status     *string `json:"status"`
	Reason     *string `json:"reason"`
}

type turnInput struct {
	TurnIndex             int32             `json:"turn_index"`
	FactsVersion          *int32            `json:"facts_version"`
	InputSeq              int64             `json:"input_seq"`
	StartedAt             *timeValue        `json:"started_at"`
	EndedAt               *timeValue        `json:"ended_at"`
	StopReason            string            `json:"stop_reason"`
	ErrorCode             *string           `json:"error_code"`
	Recovered             bool              `json:"recovered"`
	ModelID               *string           `json:"model_id"`
	Thinking              *thinkingInput    `json:"thinking"`
	ThinkingEnabled       *bool             `json:"-"`
	ThinkingEffort        *string           `json:"-"`
	ResourcesID           string            `json:"resources_snapshot_id"`
	ClientVersion         *string           `json:"client_version"`
	EngineVersion         *string           `json:"engine_version"`
	Usage                 *usageInput       `json:"usage"`
	SubagentUsage         *usageInput       `json:"subagent_usage"`
	InputTokens           *int64            `json:"-"`
	OutputTokens          *int64            `json:"-"`
	CacheCreation         *int64            `json:"-"`
	CacheRead             *int64            `json:"-"`
	SubagentInput         *int64            `json:"-"`
	SubagentOutput        *int64            `json:"-"`
	SubagentCacheCreation *int64            `json:"-"`
	SubagentCacheRead     *int64            `json:"-"`
	ContextUsed           *int64            `json:"context_used"`
	ContextWindow         *int64            `json:"context_window"`
	Input                 *inputInfo        `json:"input"`
	FilesChanged          *filesInput       `json:"files_changed"`
	Permissions           *permissionsInput `json:"permissions"`
	InputKind             string            `json:"-"`
	InputClientType       *string           `json:"-"`
	InputMachineID        *string           `json:"-"`
	CommandSkillID        *string           `json:"-"`
	Attachments           int32             `json:"-"`
	CanvasNodes           int32             `json:"-"`
	Steers                int32             `json:"-"`
	FilesCreated          int32             `json:"-"`
	FilesUpdated          int32             `json:"-"`
	FilesDeleted          int32             `json:"-"`
	Compactions           int32             `json:"compactions"`
	PermissionsAsked      int32             `json:"-"`
	PermissionsAllowed    int32             `json:"-"`
	PermissionsDenied     int32             `json:"-"`
	Truncated             bool              `json:"truncated"`
	Tools                 []toolInput       `json:"tools"`
	SkillEvents           []skillEventInput `json:"skill_events"`
}

type thinkingInput struct {
	Enabled *bool   `json:"enabled"`
	Effort  *string `json:"effort"`
}

type usageInput struct {
	InputTokens   *int64 `json:"input_tokens"`
	OutputTokens  *int64 `json:"output_tokens"`
	CacheCreation *int64 `json:"cache_creation_input_tokens"`
	CacheRead     *int64 `json:"cache_read_input_tokens"`
}

type inputOrigin struct {
	ClientType *string `json:"client_type"`
	MachineID  *string `json:"machine_id"`
}

type inputInfo struct {
	Kind           string       `json:"kind"`
	Origin         *inputOrigin `json:"origin"`
	CommandSkillID *string      `json:"command_skill_id"`
	Attachments    int32        `json:"attachments"`
	CanvasNodes    int32        `json:"canvas_nodes"`
	Steers         int32        `json:"steers"`
}

type filesInput struct {
	Created int32 `json:"created"`
	Updated int32 `json:"updated"`
	Deleted int32 `json:"deleted"`
}

type permissionsInput struct {
	Asked   int32 `json:"asked"`
	Allowed int32 `json:"allowed"`
	Denied  int32 `json:"denied"`
}

type toolInput struct {
	Ordinal         *int32  `json:"ordinal"`
	Category        string  `json:"category"`
	Name            *string `json:"name"`
	ResourceID      *string `json:"resource_id"`
	ResourceOrigin  *string `json:"resource_origin"`
	ResourceVersion *string `json:"resource_version"`
	Server          *string `json:"server"`
	Target          *string `json:"target"`
	Calls           int32   `json:"calls"`
	Failed          int32   `json:"failed"`
	DurationMS      int64   `json:"duration_ms"`
}

type skillEventInput struct {
	Ordinal *int32  `json:"ordinal"`
	SkillID *string `json:"skill_id"`
	Name    *string `json:"name"`
	Origin  *string `json:"origin"`
	Version *string `json:"version"`
	Digest  *string `json:"digest"`
	Trigger string  `json:"trigger"`
	OK      bool    `json:"ok"`
	Reason  *string `json:"reason"`
}

func decodeBody(w http.ResponseWriter, r *http.Request, limit int, target any) error {
	compressedLimit, decodedLimit := limit, limit
	encoding := strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Encoding")))
	if encoding != "" && encoding != "identity" && encoding != "gzip" {
		return resource.Invalid("不支持的 Content-Encoding")
	}
	if encoding == "gzip" && limit == maxTurnsBodyBytes {
		compressedLimit, decodedLimit = 4<<20, 32<<20
	}
	if r.ContentLength > int64(compressedLimit) {
		return sessionFailure(http.StatusRequestEntityTooLarge, "payload_too_large", "请求体超过大小限制")
	}
	body := io.ReadCloser(http.MaxBytesReader(w, r.Body, int64(compressedLimit)))
	if encoding == "gzip" {
		unzipped, err := gzip.NewReader(body)
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				return sessionFailure(http.StatusRequestEntityTooLarge, "payload_too_large", "请求体超过大小限制")
			}
			return resource.Invalid("gzip 请求格式无效")
		}
		defer unzipped.Close()
		body = http.MaxBytesReader(w, unzipped, int64(decodedLimit))
	}
	decoder := json.NewDecoder(body)
	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return sessionFailure(http.StatusRequestEntityTooLarge, "payload_too_large", "请求体超过大小限制")
		}
		return resource.Invalid("请求格式无效")
	}
	if data := bytes.TrimSpace(raw); len(data) == 0 || data[0] != '{' {
		return resource.Invalid("请求必须为 JSON 对象")
	}
	if err := validateUniqueJSON(raw); err != nil {
		return resource.Invalid("请求 JSON 字段重复或格式无效")
	}
	if err := decoder.Decode(new(json.RawMessage)); !errors.Is(err, io.EOF) {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return sessionFailure(http.StatusRequestEntityTooLarge, "payload_too_large", "请求体超过大小限制")
		}
		if err == nil {
			return resource.Invalid("请求只能包含一个 JSON 对象")
		}
		return resource.Invalid("请求格式无效")
	}
	strict := json.NewDecoder(bytes.NewReader(raw))
	strict.DisallowUnknownFields()
	if err := strict.Decode(target); err != nil {
		return resource.Invalid("请求字段或格式无效")
	}
	return nil
}

func requiredString(value string, limit int) bool {
	return validText(strings.TrimSpace(value), limit, true)
}
