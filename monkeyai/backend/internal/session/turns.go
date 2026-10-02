package session

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/session/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type normalizedSnapshotItem struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	Name      *string `json:"name,omitempty"`
	Source    *string `json:"source,omitempty"`
	Version   *string `json:"version,omitempty"`
	Digest    *string `json:"digest,omitempty"`
	Enabled   bool    `json:"enabled"`
	Available bool    `json:"available"`
	Status    *string `json:"status,omitempty"`
	Reason    *string `json:"reason,omitempty"`
}

type preparedSnapshot struct {
	input snapshotInput
	json  []byte
	hash  string
	items []normalizedSnapshotItem
}

var allowedErrorCodes = map[string]struct{}{
	"upstream_unauthorized": {},
	"upstream_rate_limited": {},
	"upstream_unavailable":  {},
}

type preparedTurn struct {
	input turnInput
	hash  []byte
	facts int32
}

func (s *Service) postTurns(w http.ResponseWriter, r *http.Request) {
	user, err := agentUser(r)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	machineID := strings.TrimSpace(r.Header.Get("X-MAI-Machine-ID"))
	if !validUUID(machineID) {
		resource.Fail(w, invalidSession("X-MAI-Machine-ID 必填且必须为 UUID"))
		return
	}
	id := chi.URLParam(r, "id")
	if !validUUID(id) {
		resource.Fail(w, invalidSession("会话 ID 无效"))
		return
	}
	afterTurn, err := parseAfterTurn(r)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	var in turnBatchInput
	if err := decodeBody(w, r, maxTurnsBodyBytes, &in); err != nil {
		resource.Fail(w, err)
		return
	}
	preparedSnapshots, preparedTurns, err := validateBatch(in)
	if err != nil {
		resource.Fail(w, err)
		return
	}

	tx, err := s.begin(r.Context())
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer rollback(r.Context(), tx)
	row, err := readSession(r.Context(), tx, id, true)
	if errors.Is(err, pgx.ErrNoRows) {
		resource.Fail(w, sessionFailure(http.StatusNotFound, "session_not_registered", "会话尚未注册"))
		return
	}
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if row.OwnerUserID != user.ID {
		resource.Fail(w, conflict("session_owned_by_other", "会话属于其他用户"))
		return
	}
	if row.PurgedAt != nil || row.DeletedAt != nil {
		resource.Fail(w, sessionFailure(http.StatusGone, "session_not_registered", "会话已清除"))
		return
	}
	if row.DeviceID == nil {
		resource.Fail(w, sessionFailure(http.StatusNotFound, "session_not_registered", "会话尚未由宿主注册"))
		return
	}
	if *row.DeviceID != machineID {
		resource.Fail(w, conflict("not_host", "会话由其他主机认领"))
		return
	}

	accepted, duplicates, err := s.applyBatch(r.Context(), tx, id, row, afterTurn, preparedSnapshots, preparedTurns)
	if err != nil {
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
	ackedSnapshots := make([]string, 0, len(preparedSnapshots))
	for _, snapshot := range preparedSnapshots {
		ackedSnapshots = append(ackedSnapshots, snapshot.input.SnapshotID)
	}
	resource.JSON(w, http.StatusOK, resource.Object{
		"acked_turn": row.AckedTurn, "accepted": accepted, "duplicates": duplicates,
		"snapshots_acked": ackedSnapshots,
	})
}

func parseAfterTurn(r *http.Request) (int32, error) {
	values, ok := r.URL.Query()["after_turn"]
	if !ok || len(values) != 1 {
		return 0, invalidState("after_turn 查询参数必填")
	}
	value, err := strconv.ParseInt(values[0], 10, 32)
	if err != nil || value < 0 {
		return 0, invalidState("after_turn 无效")
	}
	return int32(value), nil
}

func validateBatch(in turnBatchInput) ([]preparedSnapshot, []preparedTurn, error) {
	snapshots := in.Snapshots
	if len(in.ResourceSnapshots) > 0 {
		if len(snapshots) > 0 {
			return nil, nil, invalidState("snapshots 只能使用一个字段")
		}
		snapshots = in.ResourceSnapshots
	}
	turns := in.Turns
	if len(in.FinishedTurns) > 0 {
		if len(turns) > 0 {
			return nil, nil, invalidState("turns 只能使用一个字段")
		}
		turns = in.FinishedTurns
	}
	if len(turns) == 0 || len(turns) > maxTurnsPerBatch {
		return nil, nil, invalidState("turns 数量必须为 1 至 50")
	}
	if len(snapshots) > maxTurnsPerBatch {
		return nil, nil, invalidState("snapshots 数量超限")
	}
	preparedSnapshots := make([]preparedSnapshot, 0, len(snapshots))
	snapshotIDs := make(map[string]struct{}, len(snapshots))
	for _, snapshot := range snapshots {
		prepared, err := prepareSnapshot(snapshot)
		if err != nil {
			return nil, nil, err
		}
		if _, ok := snapshotIDs[snapshot.SnapshotID]; ok {
			return nil, nil, invalidState("snapshots 不得重复")
		}
		snapshotIDs[snapshot.SnapshotID] = struct{}{}
		preparedSnapshots = append(preparedSnapshots, prepared)
	}
	preparedTurns := make([]preparedTurn, 0, len(turns))
	seen := make(map[int32][]byte, len(turns))
	var previousIndex int32
	for _, turn := range turns {
		if turn.TurnIndex <= previousIndex {
			return nil, nil, invalidState("turn_index 必须严格递增")
		}
		previousIndex = turn.TurnIndex
		prepared, err := prepareTurn(turn, in.FactsVersion)
		if err != nil {
			return nil, nil, err
		}
		if previous, ok := seen[turn.TurnIndex]; ok {
			if !bytes.Equal(previous, prepared.hash) {
				return nil, nil, conflict("report_conflict", "同一 turn_index 的上报内容冲突")
			}
			return nil, nil, invalidState("turn_index 不得重复")
		}
		seen[turn.TurnIndex] = prepared.hash
		preparedTurns = append(preparedTurns, prepared)
	}
	return preparedSnapshots, preparedTurns, nil
}

func prepareSnapshot(in snapshotInput) (preparedSnapshot, error) {
	if !requiredString(strings.TrimSpace(in.SnapshotID), 80) || len(in.Items) > maxSnapshotItems || in.Items == nil {
		return preparedSnapshot{}, invalidState("资源快照无效")
	}
	items := make([]normalizedSnapshotItem, 0, len(in.Items))
	seen := make(map[string]struct{}, len(in.Items))
	for _, item := range in.Items {
		resourceID := strings.TrimSpace(item.ResourceID)
		aliasID := strings.TrimSpace(item.ID)
		if resourceID != "" && aliasID != "" && resourceID != aliasID {
			return preparedSnapshot{}, invalidState("资源快照 id 与 resource_id 不一致")
		}
		if resourceID == "" {
			resourceID = aliasID
		}
		kind := strings.TrimSpace(item.Kind)
		if !requiredString(resourceID, 256) || !requiredString(kind, 128) {
			return preparedSnapshot{}, invalidState("资源快照条目无效")
		}
		if _, ok := seen[resourceID]; ok {
			return preparedSnapshot{}, invalidState("资源快照 resource_id 不得重复")
		}
		seen[resourceID] = struct{}{}
		for _, value := range []*string{item.Name, item.Source, item.Version, item.Digest, item.Status, item.Reason} {
			if value != nil && !validText(*value, maxTextLength, false) {
				return preparedSnapshot{}, invalidState("资源快照字符串字段过长或非法")
			}
		}
		items = append(items, normalizedSnapshotItem{
			ID: resourceID, Kind: kind, Name: item.Name, Source: item.Source,
			Version: item.Version, Digest: item.Digest, Enabled: boolValue(item.Enabled),
			Available: boolValue(item.Available), Status: item.Status, Reason: item.Reason,
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	data, err := json.Marshal(items)
	if err != nil {
		return preparedSnapshot{}, err
	}
	digest := sha256.Sum256(data)
	expected := hex.EncodeToString(digest[:])
	if in.SnapshotID != "sha256:"+expected {
		return preparedSnapshot{}, conflict("unknown_resources_snapshot", "snapshot_id 必须是规范化 items 的 sha256")
	}
	return preparedSnapshot{input: in, json: data, hash: expected, items: items}, nil
}

func prepareTurn(in turnInput, batchFacts *int32) (preparedTurn, error) {
	if in.TurnIndex <= 0 || in.TurnIndex > 1<<30 || !requiredString(strings.TrimSpace(in.ResourcesID), 256) {
		return preparedTurn{}, invalidState("turn 字段无效")
	}
	if in.StartedAt == nil || in.EndedAt == nil || in.EndedAt.Time.Before(in.StartedAt.Time) {
		return preparedTurn{}, sessionFailure(http.StatusBadRequest, "time_order", "turn 时间顺序无效")
	}
	if !contains([]string{"complete", "interrupted", "error", "max_turns", "output_limit", "unknown"}, in.StopReason) {
		return preparedTurn{}, invalidState("stop_reason 无效")
	}
	if in.ErrorCode != nil {
		if _, ok := allowedErrorCodes[*in.ErrorCode]; !ok {
			in.ErrorCode = nil
		}
	}
	facts := batchFacts
	if in.FactsVersion != nil {
		facts = in.FactsVersion
	}
	if facts == nil || *facts <= 0 {
		return preparedTurn{}, invalidState("facts_version 必填且必须为正数")
	}
	hash, err := turnHash(in, *facts)
	if err != nil {
		return preparedTurn{}, err
	}
	if in.Input == nil || !requiredString(in.Input.Kind, 128) {
		return preparedTurn{}, invalidState("input.kind 必填")
	}
	in.InputKind = in.Input.Kind
	if in.Input.Origin != nil {
		in.InputClientType, in.InputMachineID = in.Input.Origin.ClientType, in.Input.Origin.MachineID
	}
	in.CommandSkillID, in.Attachments, in.CanvasNodes, in.Steers = in.Input.CommandSkillID, in.Input.Attachments, in.Input.CanvasNodes, in.Input.Steers
	if in.Thinking != nil {
		in.ThinkingEnabled, in.ThinkingEffort = in.Thinking.Enabled, in.Thinking.Effort
	}
	if in.Usage != nil {
		in.InputTokens, in.OutputTokens, in.CacheCreation, in.CacheRead = in.Usage.InputTokens, in.Usage.OutputTokens, in.Usage.CacheCreation, in.Usage.CacheRead
	}
	if in.SubagentUsage != nil {
		in.SubagentInput, in.SubagentOutput, in.SubagentCacheCreation, in.SubagentCacheRead = in.SubagentUsage.InputTokens, in.SubagentUsage.OutputTokens, in.SubagentUsage.CacheCreation, in.SubagentUsage.CacheRead
	}
	if in.FilesChanged != nil {
		in.FilesCreated, in.FilesUpdated, in.FilesDeleted = in.FilesChanged.Created, in.FilesChanged.Updated, in.FilesChanged.Deleted
	}
	if in.Permissions != nil {
		in.PermissionsAsked, in.PermissionsAllowed, in.PermissionsDenied = in.Permissions.Asked, in.Permissions.Allowed, in.Permissions.Denied
	}
	if in.InputSeq < 0 || in.Attachments < 0 || in.CanvasNodes < 0 || in.Steers < 0 || in.FilesCreated < 0 || in.FilesUpdated < 0 || in.FilesDeleted < 0 || in.Compactions < 0 || in.PermissionsAsked < 0 || in.PermissionsAllowed < 0 || in.PermissionsDenied < 0 {
		return preparedTurn{}, invalidState("turn 计数不能为负数")
	}
	for _, value := range []*int64{in.InputTokens, in.OutputTokens, in.CacheCreation, in.CacheRead, in.SubagentInput, in.SubagentOutput, in.SubagentCacheCreation, in.SubagentCacheRead, in.ContextUsed, in.ContextWindow} {
		if value != nil && *value < 0 {
			return preparedTurn{}, invalidState("token 计数不能为负数")
		}
	}
	if in.ModelID != nil && *in.ModelID != "" && !validUUID(*in.ModelID) {
		return preparedTurn{}, invalidState("model_id 无效")
	}
	for _, value := range []*string{in.ErrorCode, in.ThinkingEffort, in.ClientVersion, in.EngineVersion, in.InputClientType, in.InputMachineID, in.CommandSkillID} {
		if value != nil && !validText(*value, maxTextLength, false) {
			return preparedTurn{}, invalidState("turn 字符串字段过长或非法")
		}
	}
	if len(in.Tools) > maxToolsPerTurn {
		return preparedTurn{}, sessionFailure(http.StatusRequestEntityTooLarge, "payload_too_large", "单轮 tools 超过 500 组，请截断并标记 truncated")
	}
	if len(in.SkillEvents) > maxSkillsPerTurn {
		return preparedTurn{}, sessionFailure(http.StatusRequestEntityTooLarge, "payload_too_large", "技能事件数量超限")
	}
	if err := validateTools(in.Tools); err != nil {
		return preparedTurn{}, err
	}
	if err := validateSkills(in.SkillEvents); err != nil {
		return preparedTurn{}, err
	}
	return preparedTurn{input: in, hash: hash, facts: *facts}, nil
}

func validateTools(items []toolInput) error {
	seen := map[int32]struct{}{}
	for index, item := range items {
		ordinal := int32(index)
		if item.Ordinal != nil {
			ordinal = *item.Ordinal
		}
		if ordinal < 0 {
			return invalidState("tool ordinal 无效")
		}
		if _, ok := seen[ordinal]; ok {
			return invalidState("tool ordinal 不得重复")
		}
		seen[ordinal] = struct{}{}
		if !contains([]string{"builtin", "skill", "workflow", "agent", "connector", "local_mcp"}, item.Category) || item.Calls <= 0 || item.Failed < 0 || item.Failed > item.Calls || item.DurationMS < 0 {
			return invalidState("tool 字段无效")
		}
		for _, value := range []*string{item.Name, item.ResourceID, item.ResourceOrigin, item.ResourceVersion, item.Server, item.Target} {
			if value != nil && !validText(*value, maxTextLength, false) {
				return invalidState("tool 字符串字段过长或非法")
			}
		}
	}
	return nil
}

func validateSkills(items []skillEventInput) error {
	seen := map[int32]struct{}{}
	for index, item := range items {
		ordinal := int32(index)
		if item.Ordinal != nil {
			ordinal = *item.Ordinal
		}
		if ordinal < 0 {
			return invalidState("skill event ordinal 无效")
		}
		if _, ok := seen[ordinal]; ok {
			return invalidState("skill event ordinal 不得重复")
		}
		seen[ordinal] = struct{}{}
		if !contains([]string{"user", "model", "workflow"}, item.Trigger) {
			return invalidState("skill event trigger 无效")
		}
		for _, value := range []*string{item.SkillID, item.Name, item.Origin, item.Version, item.Digest, item.Reason} {
			if value != nil && !validText(*value, maxTextLength, false) {
				return invalidState("skill event 字符串字段过长或非法")
			}
		}
	}
	return nil
}

func (s *Service) applyBatch(ctx context.Context, tx pgx.Tx, sessionID string, row sessionRow, afterTurn int32, snapshots []preparedSnapshot, turns []preparedTurn) (int, int, error) {
	acked, err := storedAckedTurn(ctx, tx, sessionID, row.AckedTurn)
	if err != nil {
		return 0, 0, err
	}
	if afterTurn != acked {
		return 0, 0, &resource.Error{
			Status: http.StatusConflict, Code: "cursor_mismatch", Message: "after_turn 与服务端确认位置不一致",
			References: resource.Object{"acked_turn": acked},
		}
	}
	existing := make(map[int32][]byte, len(turns))
	newIndexes := make([]int32, 0, len(turns))
	for _, turn := range turns {
		hash, err := sqlc.New(tx).GetTurnHash(ctx, sqlc.GetTurnHashParams{
			Column1: sessionID, TurnIndex: turn.input.TurnIndex,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			if turn.input.TurnIndex <= acked {
				return 0, 0, conflict("report_conflict", "已确认的轮次报告不存在")
			}
			newIndexes = append(newIndexes, turn.input.TurnIndex)
			continue
		}
		if err != nil {
			return 0, 0, err
		}
		existing[turn.input.TurnIndex] = hash
		if !bytes.Equal(hash, turn.hash) {
			return 0, 0, conflict("report_conflict", "相同 turn_index 的报告内容不一致")
		}
	}
	if len(newIndexes) > 0 {
		sort.Slice(newIndexes, func(i, j int) bool { return newIndexes[i] < newIndexes[j] })
		for i, index := range newIndexes {
			want := acked + int32(i) + 1
			if index != want {
				return 0, 0, conflict("cursor_mismatch", "turn_index 必须连续上报")
			}
		}
	}
	for _, snapshot := range snapshots {
		if err := persistSnapshot(ctx, tx, sessionID, snapshot); err != nil {
			return 0, 0, err
		}
	}
	for _, turn := range turns {
		if _, ok := existing[turn.input.TurnIndex]; ok {
			continue
		}
		if err := ensureSnapshot(ctx, tx, sessionID, turn.input.ResourcesID); err != nil {
			return 0, 0, err
		}
		if err := insertTurn(ctx, tx, sessionID, turn); err != nil {
			return 0, 0, err
		}
	}
	if err := s.recompute(ctx, tx, sessionID, row.AckedTurn); err != nil {
		return 0, 0, err
	}
	return len(newIndexes), len(existing), nil
}

func storedAckedTurn(ctx context.Context, tx pgx.Tx, sessionID string, floor int32) (int32, error) {
	indexes, err := sqlc.New(tx).ListTurnIndexes(ctx, sessionID)
	if err != nil {
		return floor, err
	}
	acked := floor
	for _, index := range indexes {
		if index <= acked {
			continue
		}
		if index != acked+1 {
			break
		}
		acked = index
	}
	return acked, nil
}

func persistSnapshot(ctx context.Context, tx pgx.Tx, sessionID string, snapshot preparedSnapshot) error {
	q := sqlc.New(tx)
	payload, err := json.Marshal(resource.Object{
		"session_id": sessionID, "snapshot_id": snapshot.input.SnapshotID,
		"revision": snapshot.input.Revision, "state_version": snapshot.input.StateVersion,
		"items": json.RawMessage(snapshot.json),
	})
	if err != nil {
		return err
	}
	if err := q.SaveSnapshot(ctx, payload); err != nil {
		return err
	}
	stored, err := q.GetSnapshotItems(ctx, sqlc.GetSnapshotItemsParams{Column1: sessionID, SnapshotID: snapshot.input.SnapshotID})
	if err != nil {
		return err
	}
	if !sameSnapshotJSON(stored, snapshot.json) {
		return conflict("unknown_resources_snapshot", "同一资源快照 ID 的内容不一致")
	}
	for index, item := range snapshot.items {
		payload, err := json.Marshal(resource.Object{
			"session_id": sessionID, "snapshot_id": snapshot.input.SnapshotID, "resource_id": item.ID,
			"kind": item.Kind, "name": item.Name, "source": item.Source, "version": item.Version,
			"digest": item.Digest, "enabled": item.Enabled, "available": item.Available,
			"status": item.Status, "reason": item.Reason,
		})
		if err != nil {
			return err
		}
		if err := q.SaveSnapshotItem(ctx, payload); err != nil {
			return fmt.Errorf("写入资源快照条目 %d: %w", index, err)
		}
	}
	return nil
}

func sameSnapshotJSON(stored, expected []byte) bool {
	var left, right any
	if err := json.Unmarshal(stored, &left); err != nil {
		return false
	}
	if err := json.Unmarshal(expected, &right); err != nil {
		return false
	}
	leftData, _ := json.Marshal(left)
	rightData, _ := json.Marshal(right)
	return bytes.Equal(leftData, rightData)
}

func ensureSnapshot(ctx context.Context, tx pgx.Tx, sessionID, snapshotID string) error {
	exists, err := sqlc.New(tx).HasSnapshot(ctx, sqlc.HasSnapshotParams{Column1: sessionID, SnapshotID: snapshotID})
	if err != nil {
		return err
	}
	if !exists {
		return conflict("unknown_resources_snapshot", "turn 引用的资源快照不存在")
	}
	return nil
}

func insertTurn(ctx context.Context, tx pgx.Tx, sessionID string, prepared preparedTurn) error {
	in := prepared.input
	q := sqlc.New(tx)
	payload, err := json.Marshal(resource.Object{
		"session_id": sessionID, "turn_index": in.TurnIndex, "facts_version": prepared.facts,
		"report_hash": fmt.Sprintf(`\x%x`, prepared.hash), "input_seq": in.InputSeq,
		"started_at": in.StartedAt.Time, "ended_at": in.EndedAt.Time, "received_at": time.Now().UTC(),
		"stop_reason": in.StopReason, "error_code": in.ErrorCode, "recovered": in.Recovered,
		"model_id": optionalString(in.ModelID), "thinking_enabled": in.ThinkingEnabled,
		"thinking_effort": in.ThinkingEffort, "resources_snapshot_id": in.ResourcesID,
		"client_version": in.ClientVersion, "engine_version": in.EngineVersion,
		"input_tokens": in.InputTokens, "output_tokens": in.OutputTokens,
		"cache_creation_input_tokens": in.CacheCreation, "cache_read_input_tokens": in.CacheRead,
		"subagent_input_tokens": in.SubagentInput, "subagent_output_tokens": in.SubagentOutput,
		"subagent_cache_creation_input_tokens": in.SubagentCacheCreation, "subagent_cache_read_input_tokens": in.SubagentCacheRead,
		"context_used": in.ContextUsed, "context_window": in.ContextWindow,
		"input_kind": in.InputKind, "input_client_type": in.InputClientType,
		"input_machine_id": in.InputMachineID, "command_skill_id": in.CommandSkillID,
		"attachments": in.Attachments, "canvas_nodes": in.CanvasNodes, "steers": in.Steers,
		"files_created": in.FilesCreated, "files_updated": in.FilesUpdated, "files_deleted": in.FilesDeleted,
		"compactions": in.Compactions, "permissions_asked": in.PermissionsAsked,
		"permissions_allowed": in.PermissionsAllowed, "permissions_denied": in.PermissionsDenied,
		"truncated": in.Truncated,
	})
	if err != nil {
		return err
	}
	if err := q.SaveTurn(ctx, payload); err != nil {
		return err
	}
	for index, item := range in.Tools {
		ordinal := int32(index)
		if item.Ordinal != nil {
			ordinal = *item.Ordinal
		}
		payload, err := json.Marshal(resource.Object{
			"session_id": sessionID, "turn_index": in.TurnIndex, "ordinal": ordinal,
			"category": item.Category, "name": item.Name, "resource_id": item.ResourceID,
			"resource_origin": item.ResourceOrigin, "resource_version": item.ResourceVersion,
			"server": item.Server, "target": item.Target, "calls": item.Calls,
			"failed": item.Failed, "duration_ms": item.DurationMS,
		})
		if err != nil {
			return err
		}
		if err := q.SaveTool(ctx, payload); err != nil {
			return err
		}
	}
	for index, item := range in.SkillEvents {
		ordinal := int32(index)
		if item.Ordinal != nil {
			ordinal = *item.Ordinal
		}
		payload, err := json.Marshal(resource.Object{
			"session_id": sessionID, "turn_index": in.TurnIndex, "ordinal": ordinal,
			"skill_id": item.SkillID, "name": item.Name, "origin": item.Origin,
			"version": item.Version, "digest": item.Digest, "trigger": item.Trigger,
			"ok": item.OK, "reason": item.Reason,
		})
		if err != nil {
			return err
		}
		if err := q.SaveSkillEvent(ctx, payload); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) recompute(ctx context.Context, tx pgx.Tx, sessionID string, floor int32) error {
	reports, err := sqlc.New(tx).ListTurnFacts(ctx, sessionID)
	if err != nil {
		return err
	}
	var (
		count        int32
		acked        int32 = floor
		next         int32 = floor + 1
		active       int64
		lastEnded    time.Time
		firstStarted time.Time
		maxActive    time.Time
		lastStop     string
		lastFacts    int32
		lastSnapshot string
		lastError    *string
	)
	for _, data := range reports {
		var report struct {
			TurnIndex  int32     `json:"turn_index"`
			StartedAt  time.Time `json:"started_at"`
			EndedAt    time.Time `json:"ended_at"`
			StopReason string    `json:"stop_reason"`
			Facts      int32     `json:"facts_version"`
			SnapshotID string    `json:"resources_snapshot_id"`
			ErrorCode  *string   `json:"error_code"`
		}
		if err := json.Unmarshal(data, &report); err != nil {
			return err
		}
		count++
		if report.TurnIndex > acked && report.TurnIndex == next {
			acked = report.TurnIndex
			next = acked + 1
		}
		seconds := int64(report.EndedAt.Sub(report.StartedAt) / time.Second)
		if seconds > 0 {
			active += seconds
		}
		if firstStarted.IsZero() || report.StartedAt.Before(firstStarted) {
			firstStarted = report.StartedAt
		}
		if report.EndedAt.After(maxActive) {
			maxActive = report.EndedAt
		}
		lastEnded, lastStop, lastFacts, lastSnapshot, lastError = report.EndedAt, report.StopReason, report.Facts, report.SnapshotID, report.ErrorCode
	}
	var failureCode *string
	switch lastStop {
	case "error":
		failureCode = lastError
		if failureCode == nil {
			fallback := "error"
			failureCode = &fallback
		}
	case "max_turns", "output_limit":
		failureCode = &lastStop
	}
	payload, err := json.Marshal(resource.Object{
		"id": sessionID, "turn_count": count, "acked_turn": acked, "active_seconds": active,
		"first_started": nullableTime(firstStarted), "last_active_at": nullableTime(maxActive),
		"ended_at": nullableTime(lastEnded), "facts_version": lastFacts,
		"failure_code": failureCode, "last_stop_reason": lastStop,
		"resources_snapshot_id": lastSnapshot, "received_at": s.now().UTC(),
	})
	if err != nil {
		return err
	}
	return sqlc.New(tx).RecomputeSession(ctx, payload)
}

func nullableTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}

func boolValue(value *bool) bool {
	return value != nil && *value
}
