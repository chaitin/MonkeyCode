package environment

import (
	"bytes"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/go-chi/chi/v5"
)

func TestHostLimitMigrationPreservesExistingEnvironments(t *testing.T) {
	s, user, host := fixture(t)
	ctx := t.Context()
	created, err := s.CreateOnHost(ctx, user, host, Creation{testSpecification(), "existing", "before-host-limit-migration"})
	if err != nil {
		t.Fatal(err)
	}
	q := sqlc.New(s.pool)
	before, err := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: created.Environment.ID})
	if err != nil {
		t.Fatal(err)
	}
	apply := func(direction string) {
		t.Helper()
		raw, err := os.ReadFile("../../migrations/000051_remove_environment_host_limit." + direction + ".sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.pool.Exec(ctx, string(raw)); err != nil {
			t.Fatal(err)
		}
	}
	apply("down")
	if _, err := s.pool.Exec(ctx, "UPDATE hosts SET max_environments=0 WHERE id=$1", host); err != nil {
		t.Fatal(err)
	}
	apply("up")
	var removed bool
	if err := s.pool.QueryRow(ctx, `SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='hosts' AND column_name='max_environments')`).Scan(&removed); err != nil || !removed {
		t.Fatal("宿主数量字段未删除", err)
	}
	after, err := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: before.ID})
	if err != nil || after.HostID != before.HostID || after.Generation != before.Generation || !bytes.Equal(after.Spec, before.Spec) {
		t.Fatal("迁移改变已有环境", err)
	}
	if _, err := s.CreateOnHost(ctx, user, host, Creation{testSpecification(), "new", "after-host-limit-migration"}); err != nil {
		t.Fatal("旧宿主零上限仍阻止新建", err)
	}
}

func TestHostSettingsRequireExplicitSchedulingAndRejectLimits(t *testing.T) {
	s, _, host := fixture(t)
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	for _, method := range []string{"PUT", "PATCH"} {
		path := "/environment-hosts/" + host
		if method == "PATCH" {
			path += "/scheduling"
		}
		for _, body := range []string{`{}`, `{"enabled":true,"max_environments":1}`} {
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
			if rec.Code != 400 {
				t.Fatal("仍接受缺失调度字段或旧上限", rec.Code, rec.Body.String())
			}
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(`{"enabled":false}`)))
		if rec.Code != 200 || strings.Contains(rec.Body.String(), "max_environments") {
			t.Fatal("调度响应仍有上限或保存失败", rec.Code, rec.Body.String())
		}
	}
}
