package session

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestValidateStateInitialAndIdempotent(t *testing.T) {
	seq := int64(0)
	in := sessionInput{
		StateSeq: &seq, SessionType: stringPtr("conversation"),
		Client:    &clientInput{Type: "desktop", MachineID: "host", Version: "1"},
		StartedAt: &timeValue{Time: time.Date(2026, 9, 29, 0, 0, 0, 0, time.UTC)},
	}
	changed, got, err := validateState(in, sessionRow{})
	if err != nil || !changed || len(got) != sha256.Size {
		t.Fatalf("初始状态未被接受: changed=%v hash=%x err=%v", changed, got, err)
	}
	row := sessionRow{Session: Session{StateSeq: seq}, StateHash: got}
	changed, _, err = validateState(in, row)
	if err != nil || changed {
		t.Fatalf("相同状态未幂等: changed=%v err=%v", changed, err)
	}
	in.Client.Version = "2"
	_, _, err = validateState(in, row)
	if code(err) != "state_conflict" {
		t.Fatalf("冲突状态错误码错误: %v", err)
	}
}

func TestPrepareSnapshotNormalizesAndChecksSHA256(t *testing.T) {
	name := "模型"
	items := []normalizedSnapshotItem{{ID: "b", Kind: "model", Name: &name, Enabled: true, Available: true}, {ID: "a", Kind: "skill"}}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	data, err := json.Marshal(items)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	input := snapshotInput{SnapshotID: "sha256:" + hex.EncodeToString(digest[:]), Items: []snapshotItem{{ID: "b", Kind: "model", Name: &name, Enabled: boolPtr(true), Available: boolPtr(true)}, {ID: "a", Kind: "skill"}}}
	prepared, err := prepareSnapshot(input)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.items[0].ID != "a" || prepared.hash != hex.EncodeToString(digest[:]) {
		t.Fatalf("快照规范化结果错误: %#v", prepared)
	}
	input.Revision = new(int64(888))
	input.StateVersion = new(int64(999))
	input.Items[0], input.Items[1] = input.Items[1], input.Items[0]
	if _, err := prepareSnapshot(input); err != nil {
		t.Fatalf("顺序或修订号改变不应改变快照摘要：%v", err)
	}
	input.SnapshotID = "sha256:" + strings.Repeat("0", 64)
	_, snapshotErr := prepareSnapshot(input)
	if codeValue := code(snapshotErr); codeValue != "unknown_resources_snapshot" {
		t.Fatalf("错误快照 ID 未被拒绝: %s", codeValue)
	}
}

func TestDecodeGzipBody(t *testing.T) {
	payload := []byte(`{"state_seq":1}`)
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(compressed.Bytes()))
	request.Header.Set("Content-Encoding", "gzip")
	var decoded struct {
		StateSeq int `json:"state_seq"`
	}
	if err := decodeBody(httptest.NewRecorder(), request, 128, &decoded); err != nil || decoded.StateSeq != 1 {
		t.Fatalf("gzip 报告应解压: seq=%d err=%v", decoded.StateSeq, err)
	}
	request = httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(compressed.Bytes()))
	request.Header.Set("Content-Encoding", "gzip")
	if err := decodeBody(httptest.NewRecorder(), request, 10, &decoded); code(err) != "payload_too_large" {
		t.Fatalf("压缩大小超过上限应拒绝: %v", err)
	}
	compressed.Reset()
	writer = gzip.NewWriter(&compressed)
	if _, err := writer.Write([]byte(`{"state_seq":1,"padding":"` + strings.Repeat("x", 300) + `"}`)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(compressed.Bytes()))
	request.Header.Set("Content-Encoding", "gzip")
	var expanded struct {
		StateSeq int    `json:"state_seq"`
		Padding  string `json:"padding"`
	}
	if err := decodeBody(httptest.NewRecorder(), request, 128, &expanded); code(err) != "payload_too_large" {
		t.Fatalf("解压大小超过上限应拒绝: %v", err)
	}
}

func TestOfficialSessionSnapshot(t *testing.T) {
	body := `{"state_seq":4,"client":{"type":"desktop","machine_id":"host","version":"26.928.1","engine_version":"1","runtime_version":"2"},"session_type":"conversation","parent_session_id":null,"expert_id":null,"model_id":null,"mode":"plan","workspace_kind":"project","started_at":"2026-09-29T10:00:00+08:00","client_deleted_at":null}`
	r := httptest.NewRequest("PUT", "/", strings.NewReader(body))
	var in sessionInput
	if err := decodeBody(httptest.NewRecorder(), r, maxSessionBodyBytes, &in); err != nil {
		t.Fatal(err)
	}
	if err := validateSessionInput(in); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"title":"提示内容"`, `"title_source":"prompt"`, `"state_hash":"fake"`} {
		modified := strings.TrimSuffix(body, "}") + "," + field + "}"
		r := httptest.NewRequest("PUT", "/", strings.NewReader(modified))
		var invalid sessionInput
		err := decodeBody(httptest.NewRecorder(), r, maxSessionBodyBytes, &invalid)
		if err == nil {
			err = validateSessionInput(invalid)
		}
		if err == nil {
			t.Fatalf("统计模式或客户端散列字段未拒绝: %s", field)
		}
	}
}

func TestOfficialTurnBatch(t *testing.T) {
	const snapshot = `{"snapshot_id":"%s","revision":7,"state_version":9,"items":[{"id":"skill/server/3f0c","kind":"skill","name":"excel","source":"team","version":"3","digest":"sha256:digest","enabled":true,"available":true,"status":"ready"}]}`
	name, source, version, digest, status := "excel", "team", "3", "sha256:digest", "ready"
	canonical, err := json.Marshal([]normalizedSnapshotItem{{ID: "skill/server/3f0c", Kind: "skill", Name: &name, Source: &source, Version: &version, Digest: &digest, Enabled: true, Available: true, Status: &status}})
	if err != nil {
		t.Fatal(err)
	}
	sha := sha256.Sum256(canonical)
	snapshotID := "sha256:" + hex.EncodeToString(sha[:])
	body := fmt.Sprintf(`{"facts_version":1,"snapshots":[`+snapshot+`],"turns":[{"turn_index":4,"input_seq":101,"started_at":"2026-09-29T10:00:00+08:00","ended_at":"2026-09-29T10:07:41+08:00","stop_reason":"complete","error_code":null,"recovered":false,"model_id":null,"thinking":{"enabled":true,"effort":"medium"},"resources_snapshot_id":"%s","client_version":"26.928.1","engine_version":"1","usage":{"input_tokens":41200,"output_tokens":3100,"cache_creation_input_tokens":0,"cache_read_input_tokens":38000},"subagent_usage":null,"context_used":51200,"context_window":200000,"input":{"kind":"prompt","origin":{"client_type":"desktop","machine_id":"3f0c"},"command_skill_id":"3f0c","attachments":1,"canvas_nodes":0,"steers":0},"files_changed":{"created":1,"updated":2,"deleted":0},"compactions":0,"permissions":{"asked":2,"allowed":2,"denied":0},"tools":[{"category":"builtin","name":"Bash","calls":7,"failed":1,"duration_ms":15400}],"skill_events":[{"skill_id":"3f0c","name":"excel","origin":"team","version":"3","digest":"sha256:digest","trigger":"user","ok":true}]}]}`, snapshotID, snapshotID)
	r := httptest.NewRequest("POST", "/?after_turn=3", strings.NewReader(body))
	var in turnBatchInput
	if err := decodeBody(httptest.NewRecorder(), r, maxTurnsBodyBytes, &in); err != nil {
		t.Fatal(err)
	}
	if after, err := parseAfterTurn(r); err != nil || after != 3 {
		t.Fatalf("游标未从 query 读取: %d %v", after, err)
	}
	snapshots, turns, err := validateBatch(in)
	if err != nil || len(snapshots) != 1 || len(turns) != 1 {
		t.Fatalf("官方嵌套字段未通过校验: %d %d %v", len(snapshots), len(turns), err)
	}
	turn := turns[0].input
	if turn.InputKind != "prompt" || turn.Attachments != 1 || turn.FilesUpdated != 2 || turn.PermissionsAllowed != 2 || turn.InputTokens == nil || *turn.InputTokens != 41200 || turn.ThinkingEnabled == nil || !*turn.ThinkingEnabled {
		t.Fatalf("嵌套字段未展开至入库列: %+v", turn)
	}
	for _, path := range []string{"/", "/?after_turn=bad", "/?after_turn=-1", "/?after_turn=1&after_turn=2"} {
		if _, err := parseAfterTurn(httptest.NewRequest("POST", path, nil)); err == nil {
			t.Fatalf("无效游标未拒绝: %s", path)
		}
	}
}

func TestTurnPayloadRejectsNestedContentAndExcessTools(t *testing.T) {
	for _, body := range []string{
		`{"facts_version":1,"turns":[{"turn_index":1,"input":{"kind":"prompt","text":"正文"}}]}`,
		`{"facts_version":1,"turns":[{"turn_index":1,"usage":{"input_tokens":2,"raw":"输出"}}]}`,
		`{"facts_version":1,"turns":[{"turn_index":1,"tools":[{"category":"builtin","calls":1,"failed":0,"duration_ms":0,"arguments":"参数"}]}]}`,
		`{"facts_version":1,"turns":[{"turn_index":1,"input":{"kind":"prompt","origin":{"machine_id":"m","unknown":"内容"}}}]}`,
	} {
		r := httptest.NewRequest("POST", "/?after_turn=0", strings.NewReader(body))
		var in turnBatchInput
		if err := decodeBody(httptest.NewRecorder(), r, maxTurnsBodyBytes, &in); err == nil {
			t.Fatalf("未知字段未被拒绝: %s", body)
		}
	}
	tools := make([]toolInput, maxToolsPerTurn+1)
	for i := range tools {
		tools[i] = toolInput{Category: "builtin", Calls: 1}
	}
	facts := int32(1)
	_, err := prepareTurn(turnInput{
		TurnIndex: 1, InputSeq: 1, StartedAt: &timeValue{Time: time.Now()}, EndedAt: &timeValue{Time: time.Now()},
		StopReason: "complete", Input: &inputInfo{Kind: "prompt"}, ResourcesID: "sha256:example", Tools: tools,
	}, &facts)
	if code(err) != "payload_too_large" {
		t.Fatalf("超过 500 组工具应返回 413：%v", err)
	}
	tools = tools[:maxToolsPerTurn]
	if err := validateTools(tools); err != nil {
		t.Fatalf("500 组工具应允许: %v", err)
	}
}

func TestUnknownErrorCodeIsNotPersisted(t *testing.T) {
	secret := "private_password_in_error"
	facts := int32(1)
	prepared, err := prepareTurn(turnInput{
		TurnIndex: 1, InputSeq: 1,
		StartedAt: &timeValue{Time: time.Now()}, EndedAt: &timeValue{Time: time.Now().Add(time.Second)},
		StopReason: "error", ErrorCode: &secret, Input: &inputInfo{Kind: "prompt"}, ResourcesID: "sha256:example",
	}, &facts)
	if err != nil || prepared.input.ErrorCode != nil {
		t.Fatalf("未知机器码不得入库: code=%v err=%v", prepared.input.ErrorCode, err)
	}
}

func TestSessionPayloadCannotSetDerivedColumns(t *testing.T) {
	body := `{"last_active_at":"2026-01-01T00:00:00Z"}`
	r := httptest.NewRequest("PUT", "/", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	var in sessionInput
	if err := decodeBody(w, r, maxSessionBodyBytes, &in); code(err) != "invalid_request" {
		t.Fatalf("派生列未被拒绝，错误=%v", err)
	}
}

func TestPrepareTurnRejectsContentFields(t *testing.T) {
	body := `{"facts_version":1,"turns":[{"turn_index":1,"input_seq":1,"started_at":"2026-01-01T00:00:00Z","ended_at":"2026-01-01T00:00:01Z","stop_reason":"complete","resources_snapshot_id":"r","input":{"kind":"prompt"},"content":"不得上报"}]}`
	r := httptest.NewRequest("POST", "/", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	var in turnBatchInput
	if err := decodeBody(w, r, maxTurnsBodyBytes, &in); code(err) != "invalid_request" {
		t.Fatalf("正文白名单未拒绝，错误=%v", err)
	}
}

func TestValidUUID(t *testing.T) {
	for _, value := range []string{"12345678-1234-1234-1234-123456789abc", "12345678-1234-1234-1234-123456789ABC"} {
		if !validUUID(value) {
			t.Fatalf("应接受 UUID：%s", value)
		}
	}
	for _, value := range []string{"bad-id", "12345678123412341234123456789abc", "12345678-1234-1234-1234-123456789abg"} {
		if validUUID(value) {
			t.Fatalf("不应接受 UUID：%s", value)
		}
	}
}

func TestSessionFilters(t *testing.T) {
	for _, path := range []string{"/sessions?cursor=abc", "/sessions?owner_user_id=invalid", "/sessions?status=unknown", "/sessions?include_purged=maybe"} {
		if _, err := sessionFilters(httptest.NewRequest("GET", path, nil)); err == nil {
			t.Fatalf("无效筛选未被拒绝：%s", path)
		}
	}
	filter, err := sessionFilters(httptest.NewRequest("GET", "/sessions?status=purged", nil))
	if err != nil || !strings.Contains(filter.where(), "purged_at IS NOT NULL") {
		t.Fatalf("墓碑筛选未生效：%s %v", filter.where(), err)
	}
}

func TestDecodeBodyLimit(t *testing.T) {
	body := bytes.NewBuffer(bytes.Repeat([]byte("x"), 64))
	r := httptest.NewRequest("POST", "/", body)
	w := httptest.NewRecorder()
	var in turnBatchInput
	if err := decodeBody(w, r, 8, &in); code(err) != "payload_too_large" {
		t.Fatalf("超限错误码错误: %v", err)
	}
}

func sessionDBFixture(t *testing.T) (*Service, *identity.Service, string, string) {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行会话数据库集成测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "session_test_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err := root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		root.Close()
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		_, _ = root.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		root.Close()
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		_, _ = root.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		root.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		if _, err := root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("清理测试 schema: %v", err)
		}
		root.Close()
	})
	paths, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) == 0 {
		t.Fatal("未找到数据库迁移")
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(data)); err != nil {
			t.Fatalf("迁移 %s: %v", path, err)
		}
	}
	userID, token := resource.ID(), resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,'会话测试用户','session-test@example.com')`, userID); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(token))
	if _, err := pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at)
VALUES($1,'monkeyai-desktop',$2,$3,now()+interval '1 hour',now()+interval '1 day')`, userID, hex.EncodeToString(hash[:]), resource.ID()); err != nil {
		t.Fatal(err)
	}
	return NewService(pool), identity.NewService(pool, nil, "http://localhost"), userID, token
}

func TestSessionReportingDatabase(t *testing.T) {
	s, identities, userID, token := sessionDBFixture(t)
	ctx := t.Context()
	sessionID, machineID, otherMachine := resource.ID(), resource.ID(), resource.ID()
	groupID := resource.ID()
	if _, err := s.pool.Exec(ctx, `INSERT INTO groups(id,name) VALUES($1,'统计分组')`, groupID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$2)`, groupID, userID); err != nil {
		t.Fatal(err)
	}

	if err := s.EnsureSession(ctx, userID, sessionID, "", ""); err != nil {
		t.Fatalf("未知会话头建立占位会话: %v", err)
	}
	var owner, group string
	var placeholder bool
	var host *string
	if err := s.pool.QueryRow(ctx, `SELECT owner_user_id::text,group_id::text,placeholder,device_id FROM sessions WHERE id=$1`, sessionID).Scan(&owner, &group, &placeholder, &host); err != nil {
		t.Fatal(err)
	}
	if owner != userID || group != groupID || !placeholder || host != nil {
		t.Fatalf("占位会话归属/分组/宿主不正确: owner=%s group=%s placeholder=%v host=%v", owner, group, placeholder, host)
	}

	router := chi.NewRouter()
	router.Use(identities.RequireAgent)
	s.RegisterAgent(router)
	request := func(method, path, machine string, body any, want int, wantCode string) resource.Object {
		t.Helper()
		var data []byte
		if body != nil {
			var err error
			data, err = json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-MAI-Machine-ID", machine)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: HTTP %d，期望 %d: %s", method, path, w.Code, want, w.Body.String())
		}
		var out resource.Object
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if wantCode != "" {
			failure, ok := out["error"].(map[string]any)
			if !ok || failure["code"] != wantCode {
				t.Fatalf("错误码 %v，期望 %s", out, wantCode)
			}
		}
		return out
	}

	start := time.Now().UTC().Truncate(time.Second).Add(-2 * time.Minute)
	put := resource.Object{
		"state_seq": 1, "session_type": "conversation", "started_at": start,
		"client": resource.Object{"type": "desktop", "machine_id": machineID, "version": "26.928.1", "engine_version": "engine-1", "runtime_version": "runtime-1"},
	}
	out := request(http.MethodPut, "/sessions/"+sessionID, machineID, put, http.StatusOK, "")
	if out["state_seq"] != float64(1) || out["acked_turn"] != float64(0) {
		t.Fatalf("首次认领应返回状态确认: %v", out)
	}
	if err := s.pool.QueryRow(ctx, `SELECT placeholder,device_id FROM sessions WHERE id=$1`, sessionID).Scan(&placeholder, &host); err != nil {
		t.Fatal(err)
	}
	if placeholder || host == nil || *host != machineID {
		t.Fatalf("首次 PUT 没有认领宿主: placeholder=%v host=%v", placeholder, host)
	}
	childID := resource.ID()
	if err := s.EnsureSession(ctx, userID, childID, sessionID, ""); err != nil {
		t.Fatalf("子代理首次调用未创建占位会话: %v", err)
	}
	var childParent, childGroup string
	if err := s.pool.QueryRow(ctx, `SELECT parent_session_id::text,group_id::text FROM sessions WHERE id=$1`, childID).Scan(&childParent, &childGroup); err != nil || childParent != sessionID || childGroup != groupID {
		t.Fatalf("子代理父会话与分组未继承: parent=%s group=%s err=%v", childParent, childGroup, err)
	}
	orphanID := resource.ID()
	if err := s.EnsureSession(ctx, userID, orphanID, resource.ID(), ""); err != nil {
		t.Fatalf("未知父会话请求头不应阻断模型调用: %v", err)
	}
	var orphanParent *string
	if err := s.pool.QueryRow(ctx, `SELECT parent_session_id::text FROM sessions WHERE id=$1`, orphanID).Scan(&orphanParent); err != nil || orphanParent != nil {
		t.Fatalf("未知父会话不应建立父子关系: parent=%v err=%v", orphanParent, err)
	}

	name := "spreadsheet"
	items := []normalizedSnapshotItem{{ID: "skill/server/1", Kind: "skill", Name: &name, Enabled: true, Available: true}}
	canonical, err := json.Marshal(items)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(canonical)
	snapshotID := "sha256:" + hex.EncodeToString(digest[:])
	turnStart := start.Add(time.Minute)
	turnEnd := turnStart.Add(30 * time.Second)
	turn := resource.Object{
		"turn_index": 1, "input_seq": 101, "started_at": turnStart, "ended_at": turnEnd,
		"stop_reason": "complete", "recovered": false, "resources_snapshot_id": snapshotID,
		"usage":         resource.Object{"input_tokens": 25, "output_tokens": 10},
		"input":         resource.Object{"kind": "prompt", "origin": resource.Object{"client_type": "desktop", "machine_id": machineID}, "attachments": 1},
		"files_changed": resource.Object{"created": 1, "updated": 0, "deleted": 0},
		"permissions":   resource.Object{"asked": 1, "allowed": 1, "denied": 0},
		"tools":         []any{resource.Object{"category": "builtin", "name": "Edit", "calls": 2, "failed": 0, "duration_ms": 23}},
		"skill_events":  []any{resource.Object{"skill_id": "skill/server/1", "name": name, "trigger": "user", "ok": true}},
	}
	batch := resource.Object{
		"facts_version": 1,
		"snapshots": []any{resource.Object{"snapshot_id": snapshotID, "revision": 7, "items": []any{resource.Object{
			"id": "skill/server/1", "kind": "skill", "name": name, "enabled": true, "available": true,
		}}}},
		"turns": []any{turn},
	}
	path := "/sessions/" + sessionID + "/turns"
	out = request(http.MethodPost, path+"?after_turn=0", machineID, batch, http.StatusOK, "")
	if out["acked_turn"] != float64(1) || out["accepted"] != float64(1) || out["duplicates"] != float64(0) {
		t.Fatalf("轮次写入确认不正确: %v", out)
	}
	ackedSnapshots, ok := out["snapshots_acked"].([]any)
	if !ok || len(ackedSnapshots) != 1 || ackedSnapshots[0] != snapshotID {
		t.Fatalf("快照确认不正确: %v", out)
	}

	var turns, acked, tools, skills, snapshots, snapshotItems int
	var inputTokens *int64
	var storedHash []byte
	if err := s.pool.QueryRow(ctx, `SELECT turn_count,acked_turn FROM sessions WHERE id=$1`, sessionID).Scan(&turns, &acked); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT input_tokens,report_hash FROM session_turns WHERE session_id=$1 AND turn_index=1`, sessionID).Scan(&inputTokens, &storedHash); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		query  string
		target *int
	}{
		{`SELECT count(*) FROM session_turn_tools WHERE session_id=$1`, &tools},
		{`SELECT count(*) FROM session_skill_events WHERE session_id=$1`, &skills},
		{`SELECT count(*) FROM session_resource_snapshots WHERE session_id=$1`, &snapshots},
		{`SELECT count(*) FROM session_resource_snapshot_items WHERE session_id=$1`, &snapshotItems},
	} {
		if err := s.pool.QueryRow(ctx, entry.query, sessionID).Scan(entry.target); err != nil {
			t.Fatal(err)
		}
	}
	if turns != 1 || acked != 1 || tools != 1 || skills != 1 || snapshots != 1 || snapshotItems != 1 || inputTokens == nil || *inputTokens != 25 || len(storedHash) != sha256.Size {
		t.Fatalf("轮次事务内容不完整: turns=%d acked=%d tools=%d skills=%d snapshots=%d items=%d tokens=%v hash=%x", turns, acked, tools, skills, snapshots, snapshotItems, inputTokens, storedHash)
	}

	out = request(http.MethodPost, path+"?after_turn=1", machineID, batch, http.StatusOK, "")
	if out["accepted"] != float64(0) || out["duplicates"] != float64(1) || out["acked_turn"] != float64(1) {
		t.Fatalf("重试不应重复计数: %v", out)
	}
	if err := s.pool.QueryRow(ctx, `SELECT turn_count,acked_turn FROM sessions WHERE id=$1`, sessionID).Scan(&turns, &acked); err != nil {
		t.Fatal(err)
	}
	if turns != 1 || acked != 1 {
		t.Fatalf("重试后轮次计数变化: turns=%d acked=%d", turns, acked)
	}

	changed := resource.Object{}
	for key, value := range turn {
		changed[key] = value
	}
	changed["input_seq"] = 102
	batch["turns"] = []any{changed}
	request(http.MethodPost, path+"?after_turn=1", machineID, batch, http.StatusConflict, "report_conflict")
	batch["turns"] = []any{turn}
	otherPut := resource.Object{}
	for key, value := range put {
		otherPut[key] = value
	}
	otherPut["state_seq"] = 2
	otherPut["client"] = resource.Object{"type": "desktop", "machine_id": otherMachine, "version": "26.928.1"}
	request(http.MethodPut, "/sessions/"+sessionID, otherMachine, otherPut, http.StatusConflict, "not_host")
	request(http.MethodPost, path+"?after_turn=1", otherMachine, batch, http.StatusConflict, "not_host")

	admin := chi.NewRouter()
	s.RegisterAdmin(admin)
	deny := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/sessions/"+sessionID, nil)
	req.Header.Set("X-Confirm-Session-ID", sessionID)
	admin.ServeHTTP(deny, req)
	if deny.Code != http.StatusForbidden {
		t.Fatalf("默认无清除权限应返回 403，实际 %d: %s", deny.Code, deny.Body.String())
	}
	if err := s.pool.QueryRow(ctx, `SELECT purged_at IS NULL FROM sessions WHERE id=$1`, sessionID).Scan(&placeholder); err != nil {
		t.Fatal(err)
	}
	if !placeholder {
		t.Fatal("拒绝清除后不能改变墓碑状态")
	}
}

func code(err error) string {
	if err == nil {
		return ""
	}
	var target *resource.Error
	if !errors.As(err, &target) {
		return ""
	}
	return target.Code
}

func boolPtr(value bool) *bool       { return &value }
func stringPtr(value string) *string { return &value }
