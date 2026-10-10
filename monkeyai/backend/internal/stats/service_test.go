package stats

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func fixture(t *testing.T) (*Service, string, string) {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行统计数据库测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "stats_test_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		root.Close()
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		root.Close()
	})
	paths, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(data)); err != nil {
			t.Fatalf("迁移 %s: %v", path, err)
		}
	}
	s := NewService(pool)
	s.now = func() time.Time { return time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC) }
	user, model := resource.ID(), resource.ID()
	exec(t, s, `INSERT INTO users(id,name,email,role) VALUES($1,'统计用户','stats@example.com','admin')`, user)
	exec(t, s, `INSERT INTO models(id,ownership_type,display_name,model_id,protocol,base_url,api_key,advanced_config,owner_user_id) VALUES($1,'system','历史模型','upstream','openai_chat_completions','https://example.com','test','{}',$2)`, model, user)
	return s, user, model
}
func exec(t *testing.T, s *Service, query string, args ...any) {
	t.Helper()
	if _, err := s.pool.Exec(t.Context(), query, args...); err != nil {
		t.Fatal(err)
	}
}
func request(t *testing.T, s *Service, path string, code int) resource.Object {
	t.Helper()
	r := chi.NewRouter()
	s.RegisterAdmin(r)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != code {
		t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
	}
	if code == 200 && w.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("统计响应应禁止缓存")
	}
	var out resource.Object
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}
func number(t *testing.T, out map[string]any, key string, want float64) {
	t.Helper()
	got, ok := out[key].(float64)
	if !ok || math.Abs(got-want) > 0.00001 {
		t.Fatalf("%s: %v，期望 %v", key, out[key], want)
	}
}
func call(t *testing.T, s *Service, user, model, status string, start, end time.Time, input, cached, output int64, duration any) {
	t.Helper()
	exec(t, s, `INSERT INTO model_calls(user_id,model_id,status,started_at,completed_at,input_tokens,cached_input_tokens,output_tokens,cache_hit,response_duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7::bigint>0,$9)`, user, model, status, start, end, input, cached, output, duration)
}
func TestModels(t *testing.T) {
	s, user, model := fixture(t)
	now := s.now()
	from := now.Add(-24 * time.Hour)
	call(t, s, user, model, "succeeded", now.Add(-2*time.Minute), now.Add(-time.Minute), 100, 50, 20, nil)
	call(t, s, user, model, "failed", now.Add(-time.Minute), now.Add(-30*time.Second), 40, 0, 10, 2000)
	call(t, s, user, model, "succeeded", from.Add(-time.Second), from, 800, 0, 80, nil)
	call(t, s, user, model, "succeeded", now, now, 900, 0, 90, nil)
	other := resource.ID()
	exec(t, s, `INSERT INTO models(id,ownership_type,display_name,model_id,protocol,base_url,api_key,advanced_config,owner_user_id) VALUES($1,'system','其他模型','other','openai_chat_completions','https://example.com','test','{}',$2)`, other, user)
	call(t, s, user, other, "succeeded", from, from.Add(time.Minute), 50, 0, 5, 1000)
	account := resource.ID()
	exec(t, s, `INSERT INTO credit_accounts(id,user_id,period_start_at,period_end_at,last_refreshed_at) VALUES($1,$2,$3,$4,$3)`, account, user, from, now)
	for _, entry := range []struct {
		kind, amount, model string
		at                  time.Time
	}{
		{"charge", "-10", model, now.Add(-time.Minute)}, {"refund", "4", model, now.Add(-time.Minute)},
		{"grant", "500", model, now.Add(-time.Minute)}, {"charge", "-3", other, now.Add(-time.Minute)},
		{"charge", "-7", model, from.Add(-time.Second)}, {"charge", "-100", model, now},
	} {
		exec(t, s, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,resource_type,resource_id,item_name,credit_delta,balance_after,occurred_at) VALUES($1,$2,$3,'model','model',$4,'测试',$5,0,$6)`, account, user, entry.kind, entry.model, entry.amount, entry.at)
	}
	exec(t, s, `UPDATE models SET deleted_at=$2 WHERE id=$1`, model, now)
	out := request(t, s, "/statistics/models?range=24h&model_id="+model, 200)
	summary := out["summary"].(map[string]any)
	for key, want := range map[string]float64{"calls": 2, "input_tokens": 140, "output_tokens": 30, "cache_hit_rate": 50, "success_rate": 50} {
		number(t, summary, key, want)
	}
	if summary["credits"] != "6.000000" {
		t.Fatalf("退款或类别归属错误: %v", summary)
	}
	previous := out["previous"].(map[string]any)
	number(t, previous, "calls", 1)
	if previous["credits"] != "7.000000" {
		t.Fatalf("上一周期: %v", previous)
	}
	trend := out["trend"].([]any)
	if len(trend) != 24 {
		t.Fatalf("趋势分桶: %d", len(trend))
	}
	var calls, input float64
	for _, point := range trend {
		row := point.(map[string]any)
		calls += row["calls"].(float64)
		input += row["input_tokens"].(float64)
	}
	if calls != 2 || input != 140 {
		t.Fatalf("趋势与总计不一致: %v %v", calls, input)
	}
	options := out["models"].([]any)
	found := false
	for _, item := range options {
		row := item.(map[string]any)
		if row["id"] == model {
			found = row["deleted"] == true
		}
	}
	if !found {
		t.Fatal("已删除模型的历史统计必须可筛选")
	}
	all := request(t, s, "/statistics/models?range=24h", 200)
	number(t, all["summary"].(map[string]any), "calls", 3)
}
func TestRealtimeRanges(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	for value, duration := range map[string]time.Duration{
		"5m":  5 * time.Minute,
		"15m": 15 * time.Minute,
		"30m": 30 * time.Minute,
		"60m": time.Hour,
		"1h":  time.Hour,
		"4h":  4 * time.Hour,
		"1d":  24 * time.Hour,
		"7d":  7 * 24 * time.Hour,
	} {
		w, err := period(httptest.NewRequest("GET", "/statistics/realtime?range="+value, nil), now, true)
		if err != nil || !w.from.Equal(now.Add(-duration)) || !w.until.Equal(now) {
			t.Fatalf("range=%s: window=%+v error=%v", value, w, err)
		}
	}
	w, err := period(httptest.NewRequest("GET", "/statistics/realtime", nil), now, true)
	if err != nil || !w.from.Equal(now.Add(-24*time.Hour)) {
		t.Fatalf("默认应为 1 天: window=%+v error=%v", w, err)
	}
	if _, err := period(httptest.NewRequest("GET", "/statistics/realtime?range=8d", nil), now, true); err == nil {
		t.Fatal("无效窗口应被拒绝")
	}
}

func TestRealtime(t *testing.T) {
	s, user, model := fixture(t)
	now := s.now()
	exec(t, s, `INSERT INTO users(name,email,status,disabled_at) VALUES('停用用户','disabled@example.com','disabled',$1)`, now)
	exec(t, s, `INSERT INTO users(name,email,deleted_at) VALUES('已删除用户','deleted@example.com',$1)`, now)
	call(t, s, user, model, "succeeded", now.Add(-time.Hour), now.Add(-2*time.Minute), 100, 0, 20, 1000)
	call(t, s, user, model, "failed", now.Add(-2*time.Minute), now.Add(-time.Minute), 50, 0, 30, 9000)
	call(t, s, user, model, "succeeded", now.Add(-2*time.Hour), now.Add(-time.Hour), 999, 0, 999, 999)
	out := request(t, s, "/statistics/realtime?range=15m", 200)
	for key, want := range map[string]float64{"model_calls": 2, "model_success_rate": 50, "p95_response_time": 8600, "rpm": 2.0 / 15, "tpm": 200.0 / 15, "total_users": 2, "active_users": 1} {
		number(t, out, key, want)
	}
	exec(t, s, `UPDATE model_calls SET response_duration_ms=NULL WHERE completed_at=$1`, now.Add(-time.Minute))
	out = request(t, s, "/statistics/realtime?range=15m", 200)
	number(t, out, "p95_response_time", 57050)
	out = request(t, s, "/statistics/realtime?range=1h", 200)
	number(t, out, "total_users", 2)
}
func TestRealtimeGroupsSubsessionsWithoutEndedAt(t *testing.T) {
	s, user, model := fixture(t)
	now := s.now()
	root, child := resource.ID(), resource.ID()
	exec(t, s, `INSERT INTO sessions(id,owner_user_id,title,session_type,client_type,client_name,started_at,last_active_at,ended_at,reporting_enabled_at)
	VALUES($1,$2,'','conversation','desktop','',$3,$3,$3,$3)`, root, user, now.Add(-time.Hour))
	exec(t, s, `INSERT INTO sessions(id,owner_user_id,parent_session_id,title,session_type,client_type,client_name,started_at,last_active_at,ended_at,reporting_enabled_at)
	VALUES($1,$2,$3,'','conversation','desktop','',$4,$4,$4,$4)`, child, user, root, now.Add(-time.Hour))
	exec(t, s, `INSERT INTO model_calls(session_id,user_id,model_id,status,started_at,completed_at) VALUES($1,$2,$3,'succeeded',$4,$5)`, child, user, model, now.Add(-2*time.Minute), now.Add(-time.Minute))
	out := request(t, s, "/statistics/realtime?range=15m", 200)
	number(t, out, "active_tasks", 1)
	number(t, out, "new_tasks", 0)
}

func TestTasksAndHistory(t *testing.T) {
	s, user, _ := fixture(t)
	now := s.now()
	from := now.Add(-7 * 24 * time.Hour)
	for _, row := range []struct {
		title            string
		start            time.Time
		ended            any
		failure, deleted any
		turns            int
	}{
		{"报告 100%", from, from.Add(100 * time.Second), nil, nil, 2},
		{"报告失败", now.Add(-3 * time.Minute), now.Add(-time.Minute), "upstream_failed", nil, 3},
		{"继续处理", now.Add(-2 * time.Minute), nil, nil, nil, 1},
		{"已删除", now.Add(-time.Minute), now, nil, now, 99},
		{"上一周期", from.Add(-time.Second), from, nil, nil, 1},
		{"右边界", now, nil, nil, nil, 0},
	} {
		var id string
		if err := s.pool.QueryRow(t.Context(), `INSERT INTO sessions(owner_user_id,title,session_type,client_type,client_name,started_at,last_active_at,ended_at,failure_code,deleted_at,turn_count,reporting_enabled_at) VALUES($1,$2,'conversation','desktop','测试客户端',$3,$3,$4,$5,$6,$7,$3) RETURNING id::text`, user, row.title, row.start, row.ended, row.failure, row.deleted, row.turns).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if row.turns > 0 && row.turns < 10 {
			exec(t, s, `INSERT INTO session_resource_snapshots(session_id,snapshot_id,items) VALUES($1,'snapshot','[]')`, id)
			for i := 1; i <= row.turns; i++ {
				outcome := "complete"
				if row.failure != nil {
					outcome = "error"
				}
				if row.ended == nil {
					outcome = "interrupted"
				}
				at := row.start.Add(time.Duration(i-1) * time.Second)
				exec(t, s, `INSERT INTO session_turns(session_id,turn_index,facts_version,report_hash,input_seq,started_at,ended_at,stop_reason,resources_snapshot_id,input_kind) VALUES($1,$2,1,'hash',1,$3,$4,$5,'snapshot','text')`, id, i, at, at.Add(100*time.Second), outcome)
			}
		}
	}
	out := request(t, s, "/statistics/tasks?range=7d", 200)
	summary := out["summary"].(map[string]any)
	for key, want := range map[string]float64{"total": 6, "completed": 2, "failed": 3, "interrupted": 1, "average_duration_seconds": 100, "completion_rate": 200.0 / 6, "anomaly_rate": 50} {
		number(t, summary, key, want)
	}
	if len(out["trend"].([]any)) != 7 || len(out["types"].([]any)) != 1 {
		t.Fatalf("分桶或类型错误: %v", out)
	}
	number(t, out["previous"].(map[string]any), "total", 1)
	out = request(t, s, "/statistics/history?task=100%25&user=STATS&page=99&page_size=1", 200)
	number(t, out, "total", 1)
	number(t, out, "page", 1)
	if out["items"].([]any)[0].(map[string]any)["title"] != "报告 100%" {
		t.Fatalf("文本过滤错误: %v", out)
	}
	out = request(t, s, "/statistics/history?from="+from.Format(time.RFC3339)+"&until="+now.Format(time.RFC3339)+"&page_size=1&page=2", 200)
	number(t, out, "total", 3)
	number(t, out, "page", 2)
	number(t, out["items"].([]any)[0].(map[string]any), "turn_count", 3)
}
func TestReportingFiltersAndCursor(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	for _, path := range []string{
		"/statistics/session-reporting/sessions?limit=101",
		"/statistics/session-reporting/sessions?cursor=invalid",
		"/statistics/session-reporting/sessions?page=1",
		"/statistics/session-reporting/sessions?outcome=failed",
		"/statistics/session-reporting/sessions?from=bad",
		"/statistics/session-reporting/sessions?from=2026-09-09T00:00:00Z&until=2026-09-08T00:00:00Z",
	} {
		f, err := parseReportingFilter(httptest.NewRequest("GET", path, nil), now)
		if err == nil && f.cursor != "" {
			_, err = f.decodeCursor()
		}
		if err == nil {
			t.Fatalf("未拒绝无效参数: %s", path)
		}
	}
	f, err := parseReportingFilter(httptest.NewRequest("GET", "/statistics/session-reporting/sessions?limit=1", nil), now)
	if err != nil {
		t.Fatal(err)
	}
	cursor := f.encodeCursor(reportCursor{At: now.Format(time.RFC3339Nano), ID: resource.ID()})
	f, err = parseReportingFilter(httptest.NewRequest("GET", "/statistics/session-reporting/sessions?limit=100&cursor="+cursor, nil), now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.decodeCursor(); err != nil {
		t.Fatal(err)
	}
	f, err = parseReportingFilter(httptest.NewRequest("GET", "/statistics/session-reporting/sessions?outcome=error&cursor="+cursor, nil), now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.decodeCursor(); err == nil {
		t.Fatal("筛选条件变化后不能复用游标")
	}
}

func TestReportingDetailAndTombstone(t *testing.T) {
	s, user, _ := fixture(t)
	id := resource.ID()
	now := s.now().Add(-time.Minute)
	exec(t, s, `INSERT INTO sessions(id,owner_user_id,title,session_type,client_type,client_name,started_at,last_active_at,reporting_enabled_at) VALUES($1,$2,'隐私标题','conversation','web','测试客户端',$3,$3,$3)`, id, user, now)
	exec(t, s, `INSERT INTO session_resource_snapshots(session_id,snapshot_id,items) VALUES($1,'snapshot','[]')`, id)
	exec(t, s, `INSERT INTO session_turns(session_id,turn_index,facts_version,report_hash,input_seq,started_at,ended_at,stop_reason,resources_snapshot_id,input_kind) VALUES($1,1,1,'hash',1,$2,$3,'error','snapshot','text')`, id, now, now.Add(time.Second))
	path := "/statistics/session-reporting/sessions/" + id
	out := request(t, s, path, 200)
	if len(out["turns"].([]any)) != 1 {
		t.Fatalf("轮次缺失: %v", out)
	}
	if _, ok := out["title"]; ok {
		t.Fatal("会话标题不得进入统计详情")
	}
	list := request(t, s, "/statistics/session-reporting/sessions?limit=1", 200)
	if list["items"].([]any)[0].(map[string]any)["id"] != id {
		t.Fatalf("会话列表缺失: %v", list)
	}
	exec(t, s, `UPDATE sessions SET purged_at=$2,deleted_at=$2 WHERE id=$1`, id, s.now())
	request(t, s, path, 410)
	request(t, s, "/statistics/session-reporting/sessions?include_purged=true", 403)
	s.SetSessionReportingAuditAuthorizer(func(*http.Request) bool { return true })
	tombstone := request(t, s, path+"?include_purged=true", 200)
	if tombstone["tombstone"] != true || tombstone["turns"] != nil {
		t.Fatalf("墓碑泄漏统计明细: %v", tombstone)
	}
}

func TestEmptyAndInvalid(t *testing.T) {
	s, _, _ := fixture(t)
	for _, path := range []string{"/statistics/models", "/statistics/tasks", "/statistics/realtime", "/statistics/history", "/statistics/session-reporting/overview", "/statistics/session-reporting/sessions", "/statistics/session-reporting/resources", "/statistics/session-reporting/clients"} {
		request(t, s, path, 200)
	}
	out := request(t, s, "/statistics/realtime", 200)
	if out["p95_response_time"] != nil || out["model_success_rate"] != nil {
		t.Fatalf("空样本不能产生百分比或时延: %v", out)
	}
	for _, path := range []string{"/statistics/models?range=invalid", "/statistics/realtime?range=8d", "/statistics/models?model_id=bad", "/statistics/history?page=0", "/statistics/history?page_size=501", "/statistics/history?from=bad", "/statistics/history?from=2026-09-09T00:00:00Z&until=2026-09-08T00:00:00Z"} {
		request(t, s, path, 400)
	}
}
