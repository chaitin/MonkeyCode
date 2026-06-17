package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/mcptoolcall"
)

type ToolCallStatus string

const (
	ToolCallStatusPending  ToolCallStatus = "pending"
	ToolCallStatusSuccess  ToolCallStatus = "success"
	ToolCallStatusFailed   ToolCallStatus = "failed"
	ToolCallStatusUnknown  ToolCallStatus = "unknown"
	ToolCallStatusRefunded ToolCallStatus = "refunded"

	ToolScopePlatform = "platform"
	ToolScopeUser     = "user"
	ToolScopeTeam     = "team"
)

type ToolCallRecord struct {
	ID                uuid.UUID
	RequestID         string
	TaskID            uuid.UUID
	UserID            uuid.UUID
	UpstreamID        uuid.UUID
	ToolID            uuid.UUID
	ToolNameSnapshot  string
	ToolScopeSnapshot string
	PriceSnapshot     int64
	Status            ToolCallStatus
	ArgsJSON          json.RawMessage
	ResultJSON        json.RawMessage
	ErrorMessage      string
	UpstreamRequestID string
	StartedAt         time.Time
	FinishedAt        *time.Time
}

type CreatePendingCall struct {
	RequestID         string
	TaskID            uuid.UUID
	UserID            uuid.UUID
	UpstreamID        uuid.UUID
	ToolID            uuid.UUID
	ToolNameSnapshot  string
	ToolScopeSnapshot string
	PriceSnapshot     int64
	ArgsJSON          json.RawMessage
}

type ToolCallStore interface {
	GetByRequestID(ctx context.Context, requestID string) (*ToolCallRecord, bool, error)
	CreatePending(ctx context.Context, req CreatePendingCall) (*ToolCallRecord, error)
	MarkSuccess(ctx context.Context, id uuid.UUID, result json.RawMessage, upstreamRequestID string) error
	MarkFailed(ctx context.Context, id uuid.UUID, errMsg string, upstreamRequestID string) error
	MarkUnknown(ctx context.Context, id uuid.UUID, errMsg string, upstreamRequestID string) error
}

type ToolCallRepo struct {
	db *db.Client
}

func NewToolCallRepo(client *db.Client) *ToolCallRepo {
	return &ToolCallRepo{db: client}
}

func (r *ToolCallRepo) GetByRequestID(ctx context.Context, requestID string) (*ToolCallRecord, bool, error) {
	row, err := r.db.MCPToolCall.Query().
		Where(mcptoolcall.RequestID(requestID)).
		Only(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("get tool call by request id %s: %w", requestID, err)
	}
	record, err := toToolCallRecord(row)
	if err != nil {
		return nil, false, err
	}
	return record, true, nil
}

func (r *ToolCallRepo) CreatePending(ctx context.Context, req CreatePendingCall) (*ToolCallRecord, error) {
	args, err := rawToMap(req.ArgsJSON)
	if err != nil {
		return nil, fmt.Errorf("decode args json: %w", err)
	}

	row, err := r.db.MCPToolCall.Create().
		SetRequestID(req.RequestID).
		SetTaskID(req.TaskID).
		SetUserID(req.UserID).
		SetUpstreamID(req.UpstreamID).
		SetToolID(req.ToolID).
		SetToolNameSnapshot(req.ToolNameSnapshot).
		SetToolScopeSnapshot(mcptoolcall.ToolScopeSnapshot(req.ToolScopeSnapshot)).
		SetPriceSnapshot(req.PriceSnapshot).
		SetStatus(mcptoolcall.StatusPending).
		SetArgsJSON(args).
		SetStartedAt(time.Now()).
		Save(ctx)
	if err != nil {
		return nil, fmt.Errorf("create pending tool call: %w", err)
	}
	return toToolCallRecord(row)
}

func (r *ToolCallRepo) MarkSuccess(ctx context.Context, id uuid.UUID, result json.RawMessage, upstreamRequestID string) error {
	resultMap, err := rawToMap(result)
	if err != nil {
		return fmt.Errorf("decode result json: %w", err)
	}
	update := r.db.MCPToolCall.UpdateOneID(id).
		SetStatus(mcptoolcall.StatusSuccess).
		SetResultJSON(resultMap).
		SetFinishedAt(time.Now())
	if upstreamRequestID != "" {
		update = update.SetUpstreamRequestID(upstreamRequestID)
	}
	return update.Exec(ctx)
}

func (r *ToolCallRepo) MarkFailed(ctx context.Context, id uuid.UUID, errMsg string, upstreamRequestID string) error {
	update := r.db.MCPToolCall.UpdateOneID(id).
		SetStatus(mcptoolcall.StatusFailed).
		SetErrorMessage(errMsg).
		SetFinishedAt(time.Now())
	if upstreamRequestID != "" {
		update = update.SetUpstreamRequestID(upstreamRequestID)
	}
	return update.Exec(ctx)
}

func (r *ToolCallRepo) MarkUnknown(ctx context.Context, id uuid.UUID, errMsg string, upstreamRequestID string) error {
	update := r.db.MCPToolCall.UpdateOneID(id).
		SetStatus(mcptoolcall.StatusUnknown).
		SetErrorMessage(errMsg).
		SetFinishedAt(time.Now())
	if upstreamRequestID != "" {
		update = update.SetUpstreamRequestID(upstreamRequestID)
	}
	return update.Exec(ctx)
}

func toToolCallRecord(row *db.MCPToolCall) (*ToolCallRecord, error) {
	args, err := json.Marshal(row.ArgsJSON)
	if err != nil {
		return nil, fmt.Errorf("marshal args json for tool call %s: %w", row.ID, err)
	}

	var result json.RawMessage
	if row.ResultJSON != nil {
		result, err = json.Marshal(row.ResultJSON)
		if err != nil {
			return nil, fmt.Errorf("marshal result json for tool call %s: %w", row.ID, err)
		}
	}

	return &ToolCallRecord{
		ID:                row.ID,
		RequestID:         row.RequestID,
		TaskID:            row.TaskID,
		UserID:            row.UserID,
		UpstreamID:        row.UpstreamID,
		ToolID:            row.ToolID,
		ToolNameSnapshot:  row.ToolNameSnapshot,
		ToolScopeSnapshot: string(row.ToolScopeSnapshot),
		PriceSnapshot:     row.PriceSnapshot,
		Status:            ToolCallStatus(row.Status),
		ArgsJSON:          args,
		ResultJSON:        result,
		ErrorMessage:      row.ErrorMessage,
		UpstreamRequestID: row.UpstreamRequestID,
		StartedAt:         row.StartedAt,
		FinishedAt:        row.FinishedAt,
	}, nil
}

func rawToMap(raw json.RawMessage) (map[string]any, error) {
	if len(raw) == 0 {
		return map[string]any{}, nil
	}

	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}
	if data == nil {
		data = map[string]any{}
	}
	return data, nil
}
