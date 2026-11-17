package environment

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"os"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestDeletionCompletionTimestampAndRecovery(t *testing.T) {
	s, user, host := fixture(t)
	ctx := t.Context()
	input := Creation{"删除回归", "create-deletion"}
	created, err := s.Create(ctx, user, input)
	if err != nil {
		t.Fatal(err)
	}
	change := Change{created.Environment.Generation, "delete-deletion"}
	deleted, err := s.Change(ctx, &user, created.Environment.ID, "deleted", change)
	if err != nil || deleted.Environment.DeletedAt != nil {
		t.Fatal("提交删除不应提前写入完成时间", deleted, err)
	}
	q := sqlc.New(s.pool)
	current := func() sqlc.Environment {
		t.Helper()
		env, err := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: created.Environment.ID, UserID: &user})
		if err != nil {
			t.Fatal(err)
		}
		return env
	}
	syncState(t, s, host, observe(created.Environment, "deleted"))
	wrongInstance := observe(deleted.Environment, "deleted")
	wrongInstance.InstanceID = resource.ID()
	syncState(t, s, host, wrongInstance)
	if env := current(); env.DeletedAt != nil || env.ObservedGeneration == env.Generation {
		t.Fatal("旧代次或不同实例报告提前确认删除", env)
	}
	syncState(t, s, host, observe(deleted.Environment, "deleted"))
	completed := current()
	if completed.DeletedAt == nil || completed.ObservedGeneration != completed.Generation {
		t.Fatal("当前代次删除完成未记录时间", completed)
	}
	syncState(t, s, host, observe(deleted.Environment, "deleted"))
	if env := current(); env.DeletedAt == nil || !env.DeletedAt.Equal(*completed.DeletedAt) {
		t.Fatal("重复报告改变删除完成时间", env)
	}
	recoveredCreation, err := s.Create(ctx, user, input)
	if err != nil || recoveredCreation.Environment.ID != created.Environment.ID ||
		recoveredCreation.Environment.DeletedAt == nil || recoveredCreation.Operation.ID != created.Operation.ID {
		t.Fatal("删除后原创建请求不能恢复或重复创建", recoveredCreation, err)
	}
	recoveredDeletion, err := s.Change(ctx, &user, created.Environment.ID, "deleted", change)
	if err != nil || recoveredDeletion.Environment.DeletedAt == nil || recoveredDeletion.Operation.ID != deleted.Operation.ID {
		t.Fatal("删除后原删除请求不能恢复", recoveredDeletion, err)
	}
	retry, err := s.Change(ctx, &user, created.Environment.ID, "deleted", Change{completed.Generation, "delete-again"})
	if err != nil || retry.Environment.DeletedAt != nil {
		t.Fatal("新代次删除仍沿用旧完成时间", retry, err)
	}
	failed := observe(retry.Environment, "failed")
	failed.Reason = "apply_failed"
	syncState(t, s, host, failed)
	if env := current(); env.DeletedAt != nil || env.Phase != "failed" {
		t.Fatal("删除失败被标记为已完成", env)
	}
}

func TestAgentListExcludesDeletedBeforePagination(t *testing.T) {
	s, user, host := fixture(t)
	ctx := t.Context()
	q := sqlc.New(s.pool)
	if _, err := q.SetQuota(ctx, sqlc.SetQuotaParams{UserID: user, HostID: host, MaxEnvironments: 10}); err != nil {
		t.Fatal(err)
	}
	var environments []View
	for i, name := range []string{"运行目标", "等待删除", "删除失败", "已删除"} {
		created, err := s.Create(ctx, user, Creation{name, "list-" + strconv.Itoa(i)})
		if err != nil {
			t.Fatal(err)
		}
		env := created.Environment
		if i > 0 {
			changed, err := s.Change(ctx, &user, env.ID, "deleted", Change{env.Generation, "delete-" + strconv.Itoa(i)})
			if err != nil {
				t.Fatal(err)
			}
			env = changed.Environment
		}
		switch i {
		case 2:
			failed := observe(env, "failed")
			failed.Reason = "apply_failed"
			syncState(t, s, host, failed)
		case 3:
			syncState(t, s, host, observe(env, "deleted"))
		}
		if _, err := s.pool.Exec(ctx, "UPDATE environments SET created_at=now()+$2*interval '1 second' WHERE id=$1", env.ID, i); err != nil {
			t.Fatal(err)
		}
		environments = append(environments, env)
	}
	var grant string
	if err := s.pool.QueryRow(ctx, "INSERT INTO oauth_grants(user_id,client_id,scopes,expires_at) VALUES($1,'monkeyai-desktop',ARRAY['environment:read'],now()+interval '1 day') RETURNING id", user).Scan(&grant); err != nil {
		t.Fatal(err)
	}
	token := resource.ID()
	digest := sha256.Sum256([]byte(token))
	if _, err := s.pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,grant_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at)
	VALUES($1,'monkeyai-desktop',$2,$3,$4,now()+interval '1 hour',now()+interval '1 day')`, user, grant, hex.EncodeToString(digest[:]), "refresh-"+token); err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	identities := identity.NewService(s.pool, nil, "https://server.test")
	router.Route("/agent", func(r chi.Router) {
		r.Use(identities.RequireAgent)
		s.RegisterAgent(r)
	})
	router.Route("/admin", s.RegisterAdmin)
	call := func(path string, out any) {
		t.Helper()
		request := httptest.NewRequest("GET", path, nil)
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), out) != nil {
			t.Fatal(path, response.Code, response.Body.String())
		}
	}
	var page struct {
		Items    []View `json:"items"`
		Page     int    `json:"page"`
		PageSize int    `json:"page_size"`
	}
	for i, path := range []string{
		"/agent/environments?page_size=1&page=1&status=all&include_deleted=true",
		"/agent/environments?page_size=1&page=2",
		"/agent/environments?page_size=1&page=3",
	} {
		call(path, &page)
		if len(page.Items) != 1 || page.Items[0].ID != environments[2-i].ID ||
			page.Items[0].DeletedAt != nil || page.Page != i+1 || page.PageSize != 1 {
			t.Fatal("已删除记录占用分页或隐藏了未完成删除", path, page)
		}
	}
	call("/agent/environments?page_size=1&page=4", &page)
	if len(page.Items) != 0 {
		t.Fatal("客户端仍返回已删除记录", page)
	}
	call("/admin/environments?status=all", &page)
	if len(page.Items) != 4 || page.Items[0].ID != environments[3].ID || page.Items[0].DeletedAt == nil {
		t.Fatal("管理端无法查看删除历史", page)
	}
	call("/admin/environments?status=deleted", &page)
	if len(page.Items) != 1 || page.Items[0].ID != environments[3].ID {
		t.Fatal("管理端已删除筛选失效", page)
	}
	var detail View
	call("/agent/environments/"+environments[3].ID, &detail)
	if detail.DeletedAt == nil || detail.Phase != "deleted" {
		t.Fatal("已删除详情无法用于确认原请求", detail)
	}
	var operations struct {
		Items []Operation `json:"items"`
	}
	call("/agent/environments/"+environments[3].ID+"/operations", &operations)
	if len(operations.Items) != 2 || operations.Items[0].Status != "succeeded" {
		t.Fatal("已删除环境操作历史丢失", operations)
	}
}

func TestDeletionMigrationBackfillsConfirmedHistory(t *testing.T) {
	s, user, host := fixture(t)
	ctx := t.Context()
	q := sqlc.New(s.pool)
	if _, err := q.SetQuota(ctx, sqlc.SetQuotaParams{UserID: user, HostID: host, MaxEnvironments: 10}); err != nil {
		t.Fatal(err)
	}
	type sample struct {
		desired, phase       string
		generation, observed int64
		hasObservation       bool
	}
	samples := []sample{
		{"deleted", "deleted", 2, 2, true},
		{"deleted", "deleted", 2, 2, false},
		{"deleted", "deleted", 3, 2, true},
		{"deleted", "running", 2, 1, true},
		{"deleted", "failed", 2, 2, true},
		{"stopped", "stopped", 1, 1, true},
	}
	var ids []string
	for _, item := range samples {
		id := resource.ID()
		created, err := s.Create(ctx, user, Creation{"迁移回归", id})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, created.Environment.ID)
		if _, err := s.pool.Exec(ctx, `UPDATE environments SET desired=$2,phase=$3,generation=$4,observed_generation=$5,
		observed_at=CASE WHEN $6::boolean THEN '2026-11-01T01:00:00Z'::timestamptz END,
		updated_at='2026-11-01T02:00:00Z' WHERE id=$1`, created.Environment.ID, item.desired, item.phase, item.generation, item.observed, item.hasObservation); err != nil {
			t.Fatal(err)
		}
	}
	apply := func(direction string) {
		t.Helper()
		raw, err := os.ReadFile("../../migrations/000045_environment_soft_delete." + direction + ".sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.pool.Exec(ctx, string(raw)); err != nil {
			t.Fatal(err)
		}
	}
	snapshot := func() string {
		t.Helper()
		var data string
		if err := s.pool.QueryRow(ctx, "SELECT jsonb_agg(to_jsonb(e)-'deleted_at' ORDER BY id)::text FROM environments e").Scan(&data); err != nil {
			t.Fatal(err)
		}
		return data
	}
	before := snapshot()
	apply("down")
	apply("up")
	for i, id := range ids {
		env, err := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: id, UserID: &user})
		if err != nil {
			t.Fatal(err)
		}
		if i < 2 {
			want := time.Date(2026, 11, 1, 1+i, 0, 0, 0, time.UTC)
			if env.DeletedAt == nil || !env.DeletedAt.Equal(want) {
				t.Fatal("历史删除完成时间未正确回填", i, env.DeletedAt)
			}
		} else if env.DeletedAt != nil {
			t.Fatal("未确认删除的历史环境被隐藏", i, env.DeletedAt)
		}
	}
	if before != snapshot() {
		t.Fatal("迁移改变原环境数据")
	}
	apply("down")
	if before != snapshot() {
		t.Fatal("回滚改变原环境数据")
	}
	apply("up")
	rows, err := q.ListEnvironments(ctx, sqlc.ListEnvironmentsParams{UserID: &user, Status: "all", Sort: "newest", Limit: 100})
	if err != nil || len(rows) != len(samples)-2 {
		t.Fatal("回填后的已删除记录未被过滤", len(rows), err)
	}
	for _, env := range rows {
		if slices.Contains(ids[:2], env.ID) {
			t.Fatal("客户端查询包含已回填的删除历史", env.ID)
		}
	}
}
