package session

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/session/sqlc"
	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAgent(router chi.Router) {
	router.Put("/sessions/{id}", s.putSession)
	router.Post("/sessions/{id}/turns", s.postTurns)
}

func agentUser(r *http.Request) (identity.User, error) {
	user, ok := identity.UserFromContext(r.Context())
	if !ok || !validUUID(user.ID) {
		return identity.User{}, sessionFailure(http.StatusUnauthorized, "unauthorized", "需要 OAuth 用户上下文")
	}
	return user, nil
}

func (s *Service) putSession(w http.ResponseWriter, r *http.Request) {
	user, err := agentUser(r)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	machineID := strings.TrimSpace(r.Header.Get("X-MAI-Machine-ID"))
	if !validUUID(machineID) {
		resource.Fail(w, invalidSession("X-MAI-Machine-ID 必须为 UUID"))
		return
	}
	id := chi.URLParam(r, "id")
	if !validUUID(id) {
		resource.Fail(w, invalidSession("会话 ID 无效"))
		return
	}
	var in sessionInput
	if err := decodeBody(w, r, maxSessionBodyBytes, &in); err != nil {
		resource.Fail(w, err)
		return
	}
	if err := validateSessionInput(in); err != nil {
		resource.Fail(w, err)
		return
	}
	if strings.TrimSpace(in.Client.MachineID) != machineID {
		resource.Fail(w, conflict("not_host", "client.machine_id 与请求宿主不一致"))
		return
	}

	tx, err := s.begin(r.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer rollback(r.Context(), tx)
	row, err := s.ensureLocked(r.Context(), tx, user.ID, id, inputString(in.ParentSessionID), "", machineID)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if err := validateSessionTimes(in, row); err != nil {
		resource.Fail(w, err)
		return
	}
	stateChanged, stateHash, err := validateState(in, row)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	q := sqlc.New(tx)
	now := s.now().UTC()
	if stateChanged {
		payload, err := json.Marshal(resource.Object{
			"id": id, "state_seq": *in.StateSeq,
			"state_hash": hex.EncodeToString(stateHash), "received_at": now,
		})
		if err != nil {
			resource.Fail(w, err)
			return
		}
		if err := q.SetState(r.Context(), payload); err != nil {
			resource.Fail(w, err)
			return
		}
	}
	payload, err := json.Marshal(resource.Object{
		"id": id, "session_type": *in.SessionType, "client_type": in.Client.Type,
		"client_version": in.Client.Version, "engine_version": in.Client.EngineVersion,
		"runtime_version": in.Client.RuntimeVersion, "expert_id": optionalString(in.ExpertID),
		"model_id": optionalString(in.ModelID), "mode": optionalString(in.Mode),
		"workspace_kind": optionalString(in.WorkspaceKind), "started_at": in.StartedAt.Time,
		"client_deleted_at": optionalTime(in.ClientDeletedAt), "received_at": now,
	})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if err := q.SaveSession(r.Context(), payload); err != nil {
		resource.Fail(w, err)
		return
	}
	row, err = readSession(r.Context(), tx, id, true)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, http.StatusOK, resource.Object{
		"state_seq":   row.StateSeq,
		"acked_turn":  row.AckedTurn,
		"server_time": s.now().UTC(),
	})
}

func validateSessionInput(in sessionInput) error {
	if in.Title != nil || in.TitleSource != nil {
		return invalidState("统计模式不允许上传标题")
	}
	if in.StateSeq == nil || *in.StateSeq < 0 || in.StartedAt == nil || in.StartedAt.Time.IsZero() {
		return invalidState("state_seq 和 started_at 必填")
	}
	if in.Client == nil || !requiredString(in.Client.MachineID, 256) || !validText(in.Client.Version, 128, false) || !validText(in.Client.EngineVersion, 128, false) || !validText(in.Client.RuntimeVersion, 128, false) {
		return invalidState("client 字段无效")
	}
	if !contains([]string{"desktop", "web", "extension", "mobile", "unknown"}, in.Client.Type) {
		return invalidState("client.type 无效")
	}
	if in.SessionType == nil || !contains([]string{"conversation", "workflow", "tool", "scheduled"}, *in.SessionType) {
		return invalidState("session_type 无效")
	}
	for _, value := range []*string{in.Mode, in.WorkspaceKind} {
		if value != nil && !validText(*value, 128, false) {
			return invalidState("会话字段无效")
		}
	}
	if in.Mode != nil && !contains([]string{"default", "plan", "auto", "bypassPermissions"}, *in.Mode) {
		return invalidState("mode 无效")
	}
	if in.WorkspaceKind != nil && !contains([]string{"chat", "project", "folder"}, *in.WorkspaceKind) {
		return invalidState("workspace_kind 无效")
	}
	for _, value := range []*string{in.ExpertID, in.ModelID, in.ParentSessionID} {
		if value != nil && *value != "" && !validUUID(*value) {
			return invalidSession("会话关联 ID 无效")
		}
	}
	if in.ClientDeletedAt != nil && in.ClientDeletedAt.Time.Before(in.StartedAt.Time) {
		return sessionFailure(http.StatusBadRequest, "time_order", "client_deleted_at 不能早于 started_at")
	}
	return nil
}

func validateSessionTimes(in sessionInput, row sessionRow) error {
	started := row.StartedAt
	if in.StartedAt != nil {
		started = in.StartedAt.Time
		if !row.Placeholder && started.Before(row.StartedAt) {
			return sessionFailure(http.StatusBadRequest, "time_order", "started_at 不能早于已记录时间")
		}
	}
	if row.EndedAt != nil && row.EndedAt.Before(started) {
		return sessionFailure(http.StatusBadRequest, "time_order", "started_at 不能晚于已有轮次")
	}
	return nil
}

func validateState(in sessionInput, row sessionRow) (bool, []byte, error) {
	data, err := json.Marshal(in)
	if err != nil {
		return false, nil, invalidState("会话快照无法规范化")
	}
	digest := sha256.Sum256(data)
	hash := digest[:]
	switch {
	case *in.StateSeq < row.StateSeq:
		return false, nil, &resource.Error{
			Status: http.StatusConflict, Code: "stale_state_seq", Message: "state_seq 已过期",
			References: resource.Object{"state_seq": row.StateSeq},
		}
	case *in.StateSeq == row.StateSeq && row.StateHash == nil:
		return true, hash, nil
	case *in.StateSeq == row.StateSeq && !bytes.Equal(hash, row.StateHash):
		return false, nil, conflict("state_conflict", "相同 state_seq 的 state_hash 不一致")
	case *in.StateSeq == row.StateSeq:
		return false, nil, nil
	default:
		return true, hash, nil
	}
}

func inputString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func optionalString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func optionalTime(value *timeValue) any {
	if value == nil {
		return nil
	}
	return value.Time
}

func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func turnHash(in turnInput, facts int32) ([]byte, error) {
	data, err := json.Marshal(struct {
		FactsVersion int32     `json:"facts_version"`
		Turn         turnInput `json:"turn"`
	}{FactsVersion: facts, Turn: in})
	if err != nil {
		return nil, invalidState("轮次无法规范化")
	}
	digest := sha256.Sum256(data)
	return digest[:], nil
}
