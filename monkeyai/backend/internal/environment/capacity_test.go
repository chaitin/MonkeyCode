package environment

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/go-chi/chi/v5"
)

func TestFullCapacityAndScheduling(t *testing.T) {
	s, user, host, in := setupFixture(t)
	ctx := t.Context()
	q := sqlc.New(s.pool)
	// 已有人工限制不再影响调度。
	if _, err := q.SetHost(ctx, sqlc.SetHostParams{HostID: host, Enabled: true, CpuMillis: 1, MemoryBytes: 1, MaxEnvironments: 0}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.saveSetup(ctx, host, in); err != nil {
		t.Fatal(err)
	}
	first, err := s.Create(ctx, user, Creation{"第一个", "first"})
	if err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	for _, enabled := range []string{"false", "true"} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("PATCH", "/environment-hosts/"+host+"/scheduling", strings.NewReader(`{"enabled":`+enabled+`}`)))
		if rec.Code != 200 {
			t.Fatal(rec.Code, rec.Body.String())
		}
		var capacity Capacity
		if err := json.Unmarshal(rec.Body.Bytes(), &capacity); err != nil || capacity.CPUMillis != 8000 || capacity.MemoryBytes != 16<<30 {
			t.Fatal(capacity, err)
		}
		if enabled == "false" {
			if _, err := s.Create(ctx, user, Creation{"禁用", "disabled"}); err == nil {
				t.Fatal("关闭调度仍创建成功")
			}
			current, _ := q.GetDefaults(ctx)
			in.Revision = current.Revision
			in.Preset.Name = "修改预设"
			if _, err := s.saveSetup(ctx, host, in); err != nil {
				t.Fatal(err)
			}
			h, _ := q.GetHost(ctx, host)
			if h.Enabled {
				t.Fatal("保存预设覆盖了调度开关")
			}
			env, _ := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: first.Environment.ID})
			if env.Desired != "running" || !env.ComputeReserved {
				t.Fatal("关闭调度影响正在运行环境")
			}
		}
	}
	if _, err := s.Create(ctx, user, Creation{"第二个", "second"}); err != nil {
		t.Fatal(err)
	}
	// 心跳容量下降时，已有实例保留，新请求被拒绝。
	if _, err := s.pool.Exec(ctx, `UPDATE engine_hosts SET report=jsonb_set(report,'{system,cpu,logical_cores}','1') WHERE id=$1`, host); err != nil {
		t.Fatal(err)
	}
	p := profile()
	p.NetworkPolicy = "public-only"
	err = s.transaction(ctx, func(q *sqlc.Queries) error { _, err := s.schedule(ctx, q, p); return err })
	if err == nil {
		t.Fatal("超过最新容量仍可调度")
	}
}
