package session

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/session/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrReportingDisabled = &resource.Error{Status: http.StatusForbidden, Code: "reporting_disabled", Message: "会话上报已关闭"}

type ReportingSettings interface {
	GetValue(context.Context, string) (json.RawMessage, error)
}

const (
	maxSessionBodyBytes = 256 << 10
	maxTurnsBodyBytes   = 8 << 20
	maxTurnsPerBatch    = 50
	maxSnapshotItems    = 1000
	maxToolsPerTurn     = 500
	maxSkillsPerTurn    = 200
	maxTextLength       = 4096
)

// Service 提供会话事实写入、查询和清除能力。
type Service struct {
	pool            *pgxpool.Pool
	now             func() time.Time
	purgeAuthorizer func(context.Context) bool
	settings        ReportingSettings
}

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool, now: time.Now} }

func (s *Service) WithPurgeAuthorizer(authorize func(context.Context) bool) *Service {
	s.purgeAuthorizer = authorize
	return s
}

func (s *Service) WithReportingSettings(settings ReportingSettings) *Service {
	s.settings = settings
	return s
}

func (s *Service) checkReporting(ctx context.Context) error {
	if s.settings == nil {
		return nil
	}
	value, err := s.settings.GetValue(ctx, "session_reporting")
	if err != nil {
		return err
	}
	var config struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.Unmarshal(value, &config); err != nil {
		return err
	}
	if !config.Enabled {
		return ErrReportingDisabled
	}
	return nil
}

func (s *Service) canPurge(ctx context.Context) bool {
	return s.purgeAuthorizer != nil && s.purgeAuthorizer(ctx)
}

func (s *Service) checkRequestLimit(w http.ResponseWriter, ctx context.Context, userID, kind string, limit int32) bool {
	now := s.now().UTC()
	bucket := now.Truncate(time.Minute)
	count, err := sqlc.New(s.pool).TakeReportingRateLimit(ctx, sqlc.TakeReportingRateLimitParams{
		UserID: userID, Kind: kind, BucketStart: bucket,
	})
	if err != nil {
		resource.Fail(w, err)
		return false
	}
	if count <= limit {
		return true
	}
	retry := int(bucket.Add(time.Minute).Sub(now).Seconds()) + 1
	w.Header().Set("Retry-After", strconv.Itoa(retry))
	resource.Fail(w, sessionFailure(http.StatusTooManyRequests, "rate_limited", "请求过于频繁"))
	return false
}

// Session 是网关解析会话时需要的最小会话视图。
type Session struct {
	ID               string     `json:"id"`
	OwnerUserID      string     `json:"owner_user_id"`
	GroupID          *string    `json:"group_id,omitempty"`
	ParentSessionID  *string    `json:"parent_session_id,omitempty"`
	ModelID          *string    `json:"model_id,omitempty"`
	DeviceID         *string    `json:"device_id,omitempty"`
	Placeholder      bool       `json:"placeholder"`
	StateSeq         int64      `json:"state_seq"`
	AckedTurn        int32      `json:"acked_turn"`
	StartedAt        time.Time  `json:"started_at"`
	LastActiveAt     *time.Time `json:"last_active_at,omitempty"`
	EndedAt          *time.Time `json:"ended_at,omitempty"`
	ReportingEnabled *time.Time `json:"reporting_enabled_at,omitempty"`
	DeletedAt        *time.Time `json:"deleted_at,omitempty"`
	PurgedAt         *time.Time `json:"purged_at,omitempty"`
}

type sessionRow struct {
	Session
	Title           string     `json:"title"`
	SessionType     string     `json:"session_type"`
	ClientType      string     `json:"client_type"`
	ClientName      string     `json:"client_name"`
	Mode            *string    `json:"mode"`
	WorkspaceKind   *string    `json:"workspace_kind"`
	ClientVersion   *string    `json:"client_version"`
	EngineVersion   *string    `json:"engine_version"`
	RuntimeVersion  *string    `json:"runtime_version"`
	StartedProvis   bool       `json:"started_provis"`
	ClockSuspect    bool       `json:"clock_suspect"`
	StateHash       []byte     `json:"state_hash"`
	StateReceivedAt *time.Time `json:"state_received_at"`
	ResourcesID     *string    `json:"resources_id"`
	FactsVersion    *int32     `json:"facts_version"`
	LastStopReason  *string    `json:"last_stop_reason"`
	ActiveSeconds   int64      `json:"active_seconds"`
	ClientDeletedAt *time.Time `json:"client_deleted_at"`
}

func sessionFailure(status int, code, message string) error {
	return &resource.Error{Status: status, Code: code, Message: message}
}

func invalidSession(message string) error {
	return sessionFailure(http.StatusBadRequest, "invalid_session", message)
}
func invalidState(message string) error {
	return sessionFailure(http.StatusBadRequest, "invalid_state", message)
}
func conflict(code, message string) error { return sessionFailure(http.StatusConflict, code, message) }

func readSession(ctx context.Context, db sqlc.DBTX, id string, lock bool) (sessionRow, error) {
	q := sqlc.New(db)
	var data []byte
	var err error
	if lock {
		data, err = q.LockSession(ctx, id)
	} else {
		data, err = q.GetSession(ctx, id)
	}
	if err != nil {
		return sessionRow{}, err
	}
	var out sessionRow
	err = json.Unmarshal(data, &out)
	return out, err
}

func rollback(ctx context.Context, tx pgx.Tx) {
	if err := tx.Rollback(context.WithoutCancel(ctx)); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
		slog.ErrorContext(ctx, "回滚会话事务失败", "error", err)
	}
}

func (s *Service) begin(ctx context.Context) (pgx.Tx, error) {
	if s == nil || s.pool == nil {
		return nil, errors.New("session service has no database pool")
	}
	return s.pool.Begin(ctx)
}

func (s *Service) ensureLocked(ctx context.Context, tx pgx.Tx, userID, sessionID, parentID, groupID, machineID string) (sessionRow, error) {
	if parentID != "" {
		if err := validateParent(ctx, tx, userID, sessionID, parentID); err != nil {
			return sessionRow{}, err
		}
	}
	if groupID == "" {
		group, err := sqlc.New(tx).CurrentSessionGroup(ctx, sqlc.CurrentSessionGroupParams{ParentID: parentID, UserID: userID})
		if err != nil {
			return sessionRow{}, err
		}
		if group != "" {
			groupID = group
		}
	}
	err := sqlc.New(tx).InsertPlaceholder(ctx, sqlc.InsertPlaceholderParams{
		ID: sessionID, OwnerUserID: userID, GroupID: groupID,
		ParentSessionID: parentID, MachineID: machineID, StartedAt: s.now().UTC(),
	})
	if err != nil {
		return sessionRow{}, err
	}

	row, err := readSession(ctx, tx, sessionID, true)
	if err != nil {
		return sessionRow{}, err
	}
	if row.OwnerUserID != userID {
		return sessionRow{}, conflict("session_owned_by_other", "会话属于其他用户")
	}
	if row.PurgedAt != nil {
		return sessionRow{}, sessionFailure(http.StatusGone, "session_not_registered", "会话已清除")
	}
	if row.DeletedAt != nil && !row.Placeholder {
		return sessionRow{}, sessionFailure(http.StatusGone, "session_not_registered", "会话已删除")
	}

	if parentID != "" {
		if row.ParentSessionID != nil && *row.ParentSessionID != parentID {
			return sessionRow{}, invalidSession("父会话不可更换")
		}
	}
	if groupID != "" && row.GroupID != nil && *row.GroupID != groupID {
		return sessionRow{}, invalidSession("会话分组不可更换")
	}
	if machineID != "" && row.DeviceID != nil && *row.DeviceID != machineID {
		return sessionRow{}, conflict("not_host", "会话由其他主机认领")
	}

	if (row.ParentSessionID == nil && parentID != "") || (row.GroupID == nil && groupID != "") || (row.DeviceID == nil && machineID != "") {
		err = sqlc.New(tx).ClaimSession(ctx, sqlc.ClaimSessionParams{
			ID: sessionID, ParentID: parentID, GroupID: groupID, MachineID: machineID,
		})
		if err != nil {
			return sessionRow{}, err
		}
		row, err = readSession(ctx, tx, sessionID, true)
		if err != nil {
			return sessionRow{}, err
		}
	}
	return row, nil
}

func validateParent(ctx context.Context, db sqlc.DBTX, userID, sessionID, parentID string) error {
	if parentID == sessionID {
		return invalidSession("会话不能引用自身为父会话")
	}
	data, err := sqlc.New(db).GetParent(ctx, parentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return invalidSession("父会话不存在")
	}
	if err != nil {
		return err
	}
	var parent struct {
		Owner   string     `json:"owner"`
		Parent  *string    `json:"parent"`
		Purged  *time.Time `json:"purged"`
		Deleted *time.Time `json:"deleted"`
	}
	if err := json.Unmarshal(data, &parent); err != nil {
		return err
	}
	if parent.Owner != userID {
		return conflict("session_owned_by_other", "父会话属于其他用户")
	}
	if parent.Parent != nil {
		return invalidSession("父会话必须是顶层会话")
	}
	if parent.Purged != nil || parent.Deleted != nil {
		return sessionFailure(http.StatusGone, "session_not_registered", "父会话已删除")
	}
	return nil
}

func validText(value string, limit int, required bool) bool {
	if len(value) > limit || strings.ContainsRune(value, 0) {
		return false
	}
	return !required || strings.TrimSpace(value) != ""
}

// ResolveSession 校验会话归属，并在合法会话尚不存在时原子创建占位会话。
func (s *Service) ResolveSession(ctx context.Context, userID, sessionID, parentID, groupID string) (Session, error) {
	if err := s.checkReporting(ctx); err != nil {
		return Session{}, err
	}
	if !validUUID(userID) || !validUUID(sessionID) || (parentID != "" && !validUUID(parentID)) || (groupID != "" && !validUUID(groupID)) {
		return Session{}, invalidSession("会话或关联 ID 无效")
	}
	tx, err := s.begin(ctx)
	if err != nil {
		return Session{}, err
	}
	defer rollback(ctx, tx)
	if parentID == sessionID {
		return Session{}, invalidSession("会话不能引用自身为父会话")
	}
	if parentID != "" {
		data, lookupErr := sqlc.New(tx).GetParent(ctx, parentID)
		if errors.Is(lookupErr, pgx.ErrNoRows) {
			parentID = ""
		} else if lookupErr != nil {
			return Session{}, lookupErr
		} else {
			var parent struct {
				Owner   string     `json:"owner"`
				Parent  *string    `json:"parent"`
				Purged  *time.Time `json:"purged"`
				Deleted *time.Time `json:"deleted"`
			}
			if err := json.Unmarshal(data, &parent); err != nil {
				return Session{}, err
			}
			if parent.Owner != userID || parent.Parent != nil || parent.Purged != nil || parent.Deleted != nil {
				parentID = ""
			}
		}
	}
	_, err = readSession(ctx, tx, sessionID, false)
	if errors.Is(err, pgx.ErrNoRows) {
		queries := sqlc.New(tx)
		if _, err := queries.LockReportingUser(ctx, userID); err != nil {
			return Session{}, err
		}
		_, err = readSession(ctx, tx, sessionID, false)
		if errors.Is(err, pgx.ErrNoRows) {
			count, err := queries.CountOpenPlaceholders(ctx, userID)
			if err != nil {
				return Session{}, err
			}
			if count >= 1000 {
				return Session{}, sessionFailure(http.StatusTooManyRequests, "rate_limited", "未登记的会话数量已达上限")
			}
		} else if err != nil {
			return Session{}, err
		}
	} else if err != nil {
		return Session{}, err
	}
	row, err := s.ensureLocked(ctx, tx, userID, sessionID, parentID, groupID, "")
	if err != nil {
		return Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, err
	}
	return row.Session, nil
}

// EnsureSession 校验或创建会话，但不向调用方暴露会话视图。
func (s *Service) EnsureSession(ctx context.Context, userID, sessionID, parentID, groupID string) error {
	_, err := s.ResolveSession(ctx, userID, sessionID, parentID, groupID)
	return err
}

func validUUID(value string) bool {
	if len(value) != 36 || value[8] != '-' || value[13] != '-' || value[18] != '-' || value[23] != '-' {
		return false
	}
	for index, char := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			continue
		}
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	var id pgtype.UUID
	return id.Scan(value) == nil && id.Valid
}
