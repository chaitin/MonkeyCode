package session

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/session/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type RuntimeStatus interface {
	RuntimeStatus(context.Context, string, string) (string, string, int64, error)
}

type liveSummary struct {
	BootID     string `json:"boot_id"`
	LeaseEpoch int64  `json:"lease_epoch"`
}

func (s *Service) WithRuntimeStatus(runtime RuntimeStatus) *Service { s.runtime = runtime; return s }

func (s *Service) indexPolicy(ctx context.Context) (bool, bool, error) {
	if s.settings == nil {
		return false, false, nil
	}
	data, err := s.settings.GetValue(ctx, "session_reporting")
	if err != nil {
		return false, false, err
	}
	var policy struct {
		Enabled bool   `json:"enabled"`
		Level   string `json:"level"`
	}
	if err = json.Unmarshal(data, &policy); err != nil {
		return false, false, err
	}
	return policy.Enabled, policy.Level == "full", nil
}

func (s *Service) IndexEnabled(ctx context.Context) (bool, error) {
	enabled, _, err := s.indexPolicy(ctx)
	return enabled, err
}

func (s *Service) liveSummary(ctx context.Context, user, machine string, live *liveSummary, verified bool) error {
	if live == nil {
		return nil
	}
	if !verified || s.runtime == nil || !validUUID(live.BootID) || live.LeaseEpoch <= 0 {
		return sessionFailure(403, "device_identity_required", "在线摘要需要当前执行身份")
	}
	status, boot, epoch, err := s.runtime.RuntimeStatus(ctx, user, machine)
	if err != nil {
		return err
	}
	if status == "offline" || status == "revoked" || status == "auth_required" || boot != live.BootID || epoch != live.LeaseEpoch {
		return conflict("device_registration_changed", "执行进程或连接代次已变化")
	}
	return nil
}

func (s *Service) sessionIndex(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	p, _ := identity.PrincipalFromContext(ctx)
	enabled, full, err := s.indexPolicy(ctx)
	if err != nil {
		resource.Fail(w, sessionFailure(503, "authorization_state_unavailable", "摘要策略暂不可用"))
		return
	}
	if !enabled {
		resource.Fail(w, ErrReportingDisabled)
		return
	}
	machine, id := r.URL.Query().Get("machine_id"), chi.URLParam(r, "id")
	if machine != "" && !validUUID(machine) || id != "" && !validUUID(id) {
		resource.Fail(w, resource.Invalid("设备或会话标识无效"))
		return
	}
	for key := range r.URL.Query() {
		if key != "machine_id" && key != "page" && key != "page_size" {
			resource.Fail(w, resource.Invalid("不支持的会话目录参数"))
			return
		}
	}
	page, size, err := resource.PageParams(r)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if id != "" {
		page, size = 1, 1
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer rollback(ctx, tx)
	q := sqlc.New(tx)
	rows, err := q.SessionIndex(ctx, sqlc.SessionIndexParams{OwnerUserID: p.UserID, MachineID: machine, SessionID: id, PageSize: int32(size), PageOffset: int32((page - 1) * size)})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	total, err := q.CountSessionIndex(ctx, sqlc.CountSessionIndexParams{OwnerUserID: p.UserID, MachineID: machine, SessionID: id})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		resource.Fail(w, err)
		return
	}
	if id != "" && len(rows) == 0 {
		resource.Fail(w, resource.NotFound)
		return
	}
	type state struct {
		status, boot string
		epoch        int64
	}
	states := map[string]state{}
	items := make([]resource.Object, 0, len(rows))
	for _, row := range rows {
		machine := *row.DeviceID
		current, ok := states[machine]
		if !ok {
			current.status = "offline"
			if s.runtime != nil {
				current.status, current.boot, current.epoch, err = s.runtime.RuntimeStatus(ctx, p.UserID, machine)
				if err != nil {
					resource.Fail(w, sessionFailure(503, "authorization_state_unavailable", "设备状态暂不可用"))
					return
				}
			}
			states[machine] = current
		}
		stale := row.LastLiveReportAt == nil || row.LiveBootID == nil || row.LiveLeaseEpoch == nil || current.boot != *row.LiveBootID || current.epoch != *row.LiveLeaseEpoch || s.now().Sub(*row.LastLiveReportAt) > 3*time.Minute || current.status == "offline" || current.status == "revoked" || current.status == "auth_required"
		item := resource.Object{"id": row.ID, "machine_id": machine, "session_type": row.SessionType, "parent_session_id": row.ParentSessionID, "state_seq": row.StateSeq, "host_revision": row.HostRevision, "started_at": row.StartedAt, "last_active_at": row.LastActiveAt, "reported_at": row.StateReceivedAt, "device_status": current.status, "stale": stale}
		if full {
			item["title"], item["title_source"] = row.Title, row.TitleSource
		}
		items = append(items, item)
	}
	w.Header().Set("Cache-Control", "no-store")
	if id != "" {
		resource.JSON(w, 200, items[0])
		return
	}
	resource.JSON(w, 200, resource.Object{"items": items, "pagination": resource.Object{"page": page, "page_size": size, "total": total}, "server_time": s.now().UTC()})
}
