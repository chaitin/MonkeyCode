package stats

import (
	"context"
	"encoding/json"
	"math"
	"math/big"
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
func TestOldModelsEndpointRemoved(t *testing.T) {
	r := chi.NewRouter()
	(&Service{}).RegisterAdmin(r)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/statistics/models?range=24h", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("旧模型统计接口应不存在: %d", w.Code)
	}
}

func TestModelsOverviewRejectsFilters(t *testing.T) {
	s := &Service{}
	w := httptest.NewRecorder()
	s.modelsOverview(w, httptest.NewRequest("GET", "/statistics/models/overview?range=7d", nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("不应接受时间筛选: %d %s", w.Code, w.Body.String())
	}
}

func TestModelsOverview(t *testing.T) {
	s, user, model := fixture(t)
	now := s.now()
	call(t, s, user, model, "succeeded", now.Add(-3*time.Minute), now.Add(-2*time.Minute), 100, 40, 20, 1000)
	exec(t, s, `UPDATE model_calls SET first_token_duration_ms=400 WHERE completed_at=$1`, now.Add(-2*time.Minute))
	call(t, s, user, model, "succeeded", now.Add(-6*time.Minute), now.Add(-5*time.Minute), 50, 0, 10, 5000)
	call(t, s, user, model, "failed", now.Add(-2*time.Minute), now.Add(-time.Minute), 40, 0, 5, 2000)
	call(t, s, user, model, "succeeded", now.Add(-41*time.Minute), now.Add(-40*time.Minute), 200, 0, 80, 4000)
	call(t, s, user, model, "succeeded", now.Add(-26*time.Hour), now.Add(-25*time.Hour), 500, 0, 50, 1000)
	call(t, s, user, model, "succeeded", now.Add(-27*time.Hour), now.Add(-26*time.Hour), 300, 0, 30, 1000)
	call(t, s, user, model, "succeeded", now.AddDate(0, 0, -90), now.AddDate(0, 0, -90).Add(time.Minute), 900, 0, 90, 1000)
	call(t, s, user, model, "succeeded", now, now, 1000, 0, 100, 1000)
	account := resource.ID()
	exec(t, s, `INSERT INTO credit_accounts(id,user_id,period_start_at,period_end_at,last_refreshed_at) VALUES($1,$2,$3,$4,$3)`, account, user, now.AddDate(0, 0, -91), now.Add(time.Hour))
	for _, entry := range []struct {
		kind, category, amount string
		at                     time.Time
	}{
		{"charge", "model", "-10", now.Add(-time.Hour)},
		{"refund", "model", "4", now.Add(-time.Minute)},
		{"refund", "model", "2", now.Add(-25 * time.Hour)},
		{"charge", "tool", "-100", now.Add(-time.Minute)},
		{"charge", "model", "-200", now},
		{"charge", "model", "-300", now.AddDate(0, 0, -90)},
	} {
		exec(t, s, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,resource_type,resource_id,item_name,credit_delta,balance_after,occurred_at) VALUES($1,$2,$3,$4,'model',$5,'测试',$6,0,$7)`, account, user, entry.kind, entry.category, model, entry.amount, entry.at)
	}
	out := request(t, s, "/statistics/models/overview", 200)
	if out["timezone"] != "UTC" {
		t.Fatalf("时区错误: %v", out["timezone"])
	}
	last24 := out["last_24h"].(map[string]any)
	for key, want := range map[string]float64{"model_calls": 4, "input_tokens": 390, "output_tokens": 115} {
		number(t, last24, key, want)
	}
	previous24 := out["previous_24h"].(map[string]any)
	for key, want := range map[string]float64{"model_calls": 2, "input_tokens": 800, "output_tokens": 80} {
		number(t, previous24, key, want)
	}
	last30 := out["last_30m"].(map[string]any)
	for key, want := range map[string]float64{"tpm": 225.0 / 30, "rpm": 3.0 / 30, "cache_hit_rate": 100.0 / 3, "model_success_rate": 200.0 / 3, "p95_response_time": 4800, "p95_first_token_time": 400} {
		number(t, last30, key, want)
	}
	days, ok := out["days"].([]any)
	if !ok || len(days) != 90 {
		t.Fatalf("应有 90 个日期: %v", out["days"])
	}
	for i, point := range days {
		row := point.(map[string]any)
		date := now.AddDate(0, 0, i-89).Format("2006-01-02")
		if row["date"] != date {
			t.Fatalf("第 %d 个日期错误: %v", i, row["date"])
		}
		calls, input, output, credits := float64(0), float64(0), float64(0), "0"
		if i == 88 {
			calls, input, output, credits = 2, 800, 80, "-2"
		}
		if i == 89 {
			calls, input, output, credits = 4, 390, 115, "6"
		}
		number(t, row, "model_calls", calls)
		number(t, row, "input_tokens", input)
		number(t, row, "output_tokens", output)
		amount, ok := new(big.Rat).SetString(row["credits"].(string))
		want, _ := new(big.Rat).SetString(credits)
		if !ok || amount.Cmp(want) != 0 {
			t.Fatalf("%s 积分错误: %v, want %s", date, row["credits"], credits)
		}
	}
}

func TestModelsOverviewComparisonBoundaries(t *testing.T) {
	s, user, model := fixture(t)
	now := s.now()
	for _, sample := range []struct {
		offset time.Duration
		input  int64
	}{
		{-48*time.Hour - time.Second, 1000},
		{-48 * time.Hour, 10},
		{-24*time.Hour - time.Second, 20},
		{-24 * time.Hour, 30},
		{-time.Second, 40},
		{0, 2000},
	} {
		end := now.Add(sample.offset)
		call(t, s, user, model, "succeeded", end.Add(-time.Minute), end, sample.input, 0, sample.input/10, 1000)
	}
	// Running calls must not contribute to either comparison window.
	for _, offset := range []time.Duration{-36 * time.Hour, -12 * time.Hour} {
		end := now.Add(offset)
		call(t, s, user, model, "running", end.Add(-time.Minute), end, 3000, 0, 300, nil)
	}
	out := request(t, s, "/statistics/models/overview", 200)
	for key, want := range map[string]float64{"model_calls": 2, "input_tokens": 70, "output_tokens": 7} {
		number(t, out["last_24h"].(map[string]any), key, want)
	}
	for key, want := range map[string]float64{"model_calls": 2, "input_tokens": 30, "output_tokens": 3} {
		number(t, out["previous_24h"].(map[string]any), key, want)
	}
}

func TestModelsOverviewEmpty(t *testing.T) {
	s, _, _ := fixture(t)
	out := request(t, s, "/statistics/models/overview", 200)
	last24 := out["last_24h"].(map[string]any)
	for _, key := range []string{"model_calls", "input_tokens", "output_tokens"} {
		number(t, last24, key, 0)
		number(t, out["previous_24h"].(map[string]any), key, 0)
	}
	last30 := out["last_30m"].(map[string]any)
	for _, key := range []string{"tpm", "rpm"} {
		number(t, last30, key, 0)
	}
	for _, key := range []string{"cache_hit_rate", "model_success_rate", "p95_response_time", "p95_first_token_time"} {
		if last30[key] != nil {
			t.Fatalf("无样本时 %s 应为 null: %v", key, last30[key])
		}
	}
	days := out["days"].([]any)
	if len(days) != 90 {
		t.Fatalf("空数据应有 90 天: %d", len(days))
	}
	for _, point := range days {
		row := point.(map[string]any)
		for _, key := range []string{"model_calls", "input_tokens", "output_tokens"} {
			number(t, row, key, 0)
		}
		if row["credits"] != "0" {
			t.Fatalf("空白日积分错误: %v", row)
		}
	}
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
		w, err := period(httptest.NewRequest("GET", "/statistics/realtime?range="+value, nil), now)
		if err != nil || !w.from.Equal(now.Add(-duration)) || !w.until.Equal(now) {
			t.Fatalf("range=%s: window=%+v error=%v", value, w, err)
		}
	}
	w, err := period(httptest.NewRequest("GET", "/statistics/realtime", nil), now)
	if err != nil || !w.from.Equal(now.Add(-24*time.Hour)) {
		t.Fatalf("默认应为 1 天: window=%+v error=%v", w, err)
	}
	if _, err := period(httptest.NewRequest("GET", "/statistics/realtime?range=8d", nil), now); err == nil {
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
func TestUsersOverviewRejectsTimeFilters(t *testing.T) {
	service := &Service{}
	w := httptest.NewRecorder()
	service.usersOverview(w, httptest.NewRequest("GET", "/statistics/users?range=7d", nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("时间筛选应被拒绝: %d %s", w.Code, w.Body.String())
	}
}

func TestUsersOverview(t *testing.T) {
	s, user, _ := fixture(t)
	now := s.now()
	exec(t, s, `UPDATE users SET created_at=$1 WHERE id=$2`, now.AddDate(0, 0, -100), user)
	var deletedUser string
	if err := s.pool.QueryRow(t.Context(), `INSERT INTO users(name,email,created_at,deleted_at) VALUES('已删除','deleted-user@example.com',$1,$2) RETURNING id::text`, now.Add(-3*time.Hour), now.Add(-time.Hour)).Scan(&deletedUser); err != nil {
		t.Fatal(err)
	}
	exec(t, s, `INSERT INTO users(name,email,created_at) VALUES('新用户','new-user@example.com',$1)`, now.Add(-2*time.Hour))
	for _, row := range []struct {
		owner string
		at    time.Time
		turns int
	}{
		{user, now.Add(-40 * time.Minute), 2},
		{user, now.Add(-25 * time.Hour), 1},
		{deletedUser, now.Add(-20 * time.Minute), 1},
	} {
		var sessionID string
		if err := s.pool.QueryRow(t.Context(), `INSERT INTO sessions(owner_user_id,title,session_type,client_type,client_name,started_at,last_active_at,reporting_enabled_at) VALUES($1,'统计会话','conversation','desktop','客户端',$2,$2,$2) RETURNING id::text`, row.owner, row.at).Scan(&sessionID); err != nil {
			t.Fatal(err)
		}
		exec(t, s, `INSERT INTO session_resource_snapshots(session_id,snapshot_id,items) VALUES($1,'snapshot','[]')`, sessionID)
		for index := range row.turns {
			at := row.at.Add(time.Duration(index) * time.Minute)
			kind := "prompt"
			if row.owner == deletedUser {
				kind = "command"
			}
			exec(t, s, `INSERT INTO session_turns(session_id,turn_index,facts_version,report_hash,input_seq,started_at,ended_at,stop_reason,resources_snapshot_id,input_kind) VALUES($1,$2::integer,1,'hash',$2::bigint,$3,$4,'complete','snapshot',$5)`, sessionID, index+1, at, at.Add(time.Second), kind)
		}
	}
	out := request(t, s, "/statistics/users", 200)
	for key, want := range map[string]float64{"total_users": 3, "new_users_24h": 2, "active_users_24h": 2} {
		number(t, out, key, want)
	}
	if out["timezone"] != "UTC" {
		t.Fatalf("时区错误: %v", out["timezone"])
	}
	days, ok := out["days"].([]any)
	if !ok || len(days) != 90 {
		t.Fatalf("应返回完整 90 天: %v", out["days"])
	}
	for i, point := range days {
		day := point.(map[string]any)
		wantDate := now.AddDate(0, 0, i-89).Format("2006-01-02")
		if day["date"] != wantDate {
			t.Fatalf("第 %d 天日期不连续: got %v, want %s", i, day["date"], wantDate)
		}
		wantNew, wantActive := float64(0), float64(0)
		if i == 88 {
			wantActive = 1
		}
		if i == 89 {
			wantNew, wantActive = 2, 2
		}
		number(t, day, "new_users", wantNew)
		number(t, day, "active_users", wantActive)
	}
}

func TestTasksOverviewRejectsTimeFilters(t *testing.T) {
	service := &Service{}
	w := httptest.NewRecorder()
	service.tasksOverview(w, httptest.NewRequest("GET", "/statistics/tasks/overview?range=7d", nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("时间筛选应被拒绝: %d %s", w.Code, w.Body.String())
	}
}

func TestTasksOverview(t *testing.T) {
	s, user, _ := fixture(t)
	now := s.now()
	makeSession := func(parent string, at time.Time, reporting, deleted, placeholder bool) string {
		t.Helper()
		var parentID, reportingAt, deletedAt any
		if parent != "" {
			parentID = parent
		}
		if reporting {
			reportingAt = at
		}
		if deleted {
			deletedAt = now
		}
		var id string
		err := s.pool.QueryRow(t.Context(), `INSERT INTO sessions(owner_user_id,parent_session_id,title,session_type,client_type,client_name,started_at,last_active_at,reporting_enabled_at,deleted_at,placeholder) VALUES($1,$2,'测试任务','conversation','desktop','客户端',$3,$3,$4,$5,$6) RETURNING id::text`, user, parentID, at, reportingAt, deletedAt, placeholder).Scan(&id)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	makeTurns := func(sessionID string, at time.Time, count int) {
		t.Helper()
		exec(t, s, `INSERT INTO session_resource_snapshots(session_id,snapshot_id,items) VALUES($1,'snapshot','[]')`, sessionID)
		for index := range count {
			started := at.Add(time.Duration(index) * time.Minute)
			exec(t, s, `INSERT INTO session_turns(session_id,turn_index,facts_version,report_hash,input_seq,started_at,ended_at,stop_reason,resources_snapshot_id,input_kind) VALUES($1,$2::integer,1,'hash',$2::bigint,$3,$4,'complete','snapshot','text')`, sessionID, index+1, started, started.Add(time.Second))
		}
	}
	old := makeSession("", now.AddDate(0, 0, -100), true, false, false)
	makeTurns(old, now.Add(-40*time.Minute), 2)
	child := makeSession(old, now.Add(-35*time.Minute), true, false, false)
	makeTurns(child, now.Add(-30*time.Minute), 2)
	recent := makeSession("", now.Add(-2*time.Hour), true, false, false)
	makeTurns(recent, now.Add(-20*time.Minute), 1)
	previous := makeSession("", now.Add(-25*time.Hour), true, false, false)
	makeTurns(previous, now.Add(-25*time.Hour), 1)
	for _, flags := range []struct{ reporting, deleted, placeholder bool }{
		{true, true, false}, {true, false, true}, {false, false, false},
	} {
		excluded := makeSession("", now.Add(-time.Hour), flags.reporting, flags.deleted, flags.placeholder)
		makeTurns(excluded, now.Add(-10*time.Minute), 1)
	}
	out := request(t, s, "/statistics/tasks/overview", 200)
	for key, want := range map[string]float64{"total_tasks": 3, "new_tasks_24h": 1, "active_tasks_24h": 2} {
		number(t, out, key, want)
	}
	if out["timezone"] != "UTC" {
		t.Fatalf("时区错误: %v", out["timezone"])
	}
	days, ok := out["days"].([]any)
	if !ok || len(days) != 90 {
		t.Fatalf("应返回完整 90 天: %v", out["days"])
	}
	for i, point := range days {
		day := point.(map[string]any)
		wantDate := now.AddDate(0, 0, i-89).Format("2006-01-02")
		if day["date"] != wantDate {
			t.Fatalf("第 %d 天日期不连续: got %v, want %s", i, day["date"], wantDate)
		}
		wantNew, wantActive := float64(0), float64(0)
		if i == 88 {
			wantNew, wantActive = 1, 1
		}
		if i == 89 {
			wantNew, wantActive = 1, 2
		}
		number(t, day, "new_tasks", wantNew)
		number(t, day, "active_tasks", wantActive)
	}
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

func TestHistory(t *testing.T) {
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
	out := request(t, s, "/statistics/history?task=100%25&user=STATS&page=99&page_size=1", 200)
	number(t, out, "total", 1)
	number(t, out, "page", 1)
	if item := out["items"].([]any)[0].(map[string]any); item["title"] != "报告 100%" || item["user_id"] != user {
		t.Fatalf("历史记录标题或用户 ID 错误: %v", item)
	}
	out = request(t, s, "/statistics/history?from="+from.Format(time.RFC3339)+"&until="+now.Format(time.RFC3339)+"&page_size=1&page=2", 200)
	number(t, out, "total", 3)
	number(t, out, "page", 2)
	number(t, out["items"].([]any)[0].(map[string]any), "turn_count", 3)
}
func TestRemovedStatisticsEndpoints(t *testing.T) {
	router := chi.NewRouter()
	(&Service{}).RegisterAdmin(router)
	for _, path := range []string{
		"/statistics/session-reporting/sessions", "/statistics/session-reporting/sessions?limit=1",
		"/statistics/session-reporting/overview", "/statistics/session-reporting/overview?from=2026-09-08T00:00:00Z",
		"/statistics/tasks", "/statistics/tasks?range=7d",
	} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusNotFound {
			t.Fatalf("已移除的统计接口应返回 404: %s: %d", path, w.Code)
		}
	}
}

func TestReportingFiltersAndCursor(t *testing.T) {
	now := time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC)
	for _, path := range []string{
		"/statistics/session-reporting/clients?limit=101",
		"/statistics/session-reporting/clients?cursor=invalid",
		"/statistics/session-reporting/clients?page=1",
		"/statistics/session-reporting/clients?outcome=failed",
		"/statistics/session-reporting/clients?from=bad",
		"/statistics/session-reporting/clients?from=2026-09-09T00:00:00Z&until=2026-09-08T00:00:00Z",
	} {
		f, err := parseReportingFilter(httptest.NewRequest("GET", path, nil), now)
		if err == nil && f.cursor != "" {
			_, err = f.decodeCursor()
		}
		if err == nil {
			t.Fatalf("未拒绝无效参数: %s", path)
		}
	}
	f, err := parseReportingFilter(httptest.NewRequest("GET", "/statistics/session-reporting/clients?limit=1", nil), now)
	if err != nil {
		t.Fatal(err)
	}
	cursor := f.encodeCursor(reportCursor{Key: "desktop"})
	f, err = parseReportingFilter(httptest.NewRequest("GET", "/statistics/session-reporting/clients?limit=100&cursor="+cursor, nil), now)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := f.decodeCursor()
	if err != nil || decoded.Key != "desktop" {
		t.Fatalf("客户端游标丢失: %+v %v", decoded, err)
	}
	f, err = parseReportingFilter(httptest.NewRequest("GET", "/statistics/session-reporting/clients?outcome=error&cursor="+cursor, nil), now)
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
	exec(t, s, `INSERT INTO session_turns(session_id,turn_index,facts_version,report_hash,input_seq,started_at,ended_at,stop_reason,resources_snapshot_id,input_kind,input_text,input_text_truncated,title,title_source) VALUES($1,1,1,'hash',1,$2,$3,'error','snapshot','prompt',$4,true,'本轮标题','user')`, id, now, now.Add(time.Second), "第一行\n第二行")
	exec(t, s, `INSERT INTO session_turns(session_id,turn_index,facts_version,report_hash,input_seq,started_at,ended_at,stop_reason,resources_snapshot_id,input_kind) VALUES($1,2,1,'hash',2,$2,$3,'complete','snapshot','prompt')`, id, now.Add(2*time.Second), now.Add(3*time.Second))
	path := "/statistics/session-reporting/sessions/" + id
	out := request(t, s, path, 200)
	turns := out["turns"].([]any)
	if len(turns) != 2 {
		t.Fatalf("轮次缺失: %v", out)
	}
	turn := turns[0].(map[string]any)
	for key, want := range map[string]any{
		"input_text": "第一行\n第二行", "input_text_truncated": true, "title": "本轮标题", "title_source": "user",
	} {
		if turn[key] != want {
			t.Fatalf("轮次字段 %s 未返回: got=%v want=%v", key, turn[key], want)
		}
	}
	legacy := turns[1].(map[string]any)
	for key, want := range map[string]any{"input_text": nil, "input_text_truncated": false, "title": nil, "title_source": nil} {
		if got, ok := legacy[key]; !ok || got != want {
			t.Fatalf("旧轮次字段 %s 默认值错误: got=%v want=%v", key, got, want)
		}
	}
	if out["title"] != "隐私标题" {
		t.Fatalf("会话标题未返回: %v", out)
	}
	exec(t, s, `UPDATE sessions SET purged_at=$2,deleted_at=$2 WHERE id=$1`, id, s.now())
	request(t, s, path, 410)
	request(t, s, path+"?include_purged=true", 403)
	s.SetSessionReportingAuditAuthorizer(func(*http.Request) bool { return true })
	tombstone := request(t, s, path+"?include_purged=true", 200)
	if tombstone["tombstone"] != true || tombstone["turns"] != nil {
		t.Fatalf("墓碑泄漏统计明细: %v", tombstone)
	}
}

func TestEmptyAndInvalid(t *testing.T) {
	s, _, _ := fixture(t)
	for _, path := range []string{"/statistics/models/overview", "/statistics/tasks/overview", "/statistics/realtime", "/statistics/history", "/statistics/conversations", "/statistics/session-reporting/resources", "/statistics/session-reporting/clients", "/statistics/session-reporting/clients/overview"} {
		request(t, s, path, 200)
	}
	out := request(t, s, "/statistics/realtime", 200)
	if out["p95_response_time"] != nil || out["model_success_rate"] != nil {
		t.Fatalf("空样本不能产生百分比或时延: %v", out)
	}
	for _, path := range []string{"/statistics/models/overview?range=invalid", "/statistics/realtime?range=8d", "/statistics/history?page=0", "/statistics/history?page_size=501", "/statistics/history?from=bad", "/statistics/history?from=2026-09-09T00:00:00Z&until=2026-09-08T00:00:00Z"} {
		request(t, s, path, 400)
	}
}
