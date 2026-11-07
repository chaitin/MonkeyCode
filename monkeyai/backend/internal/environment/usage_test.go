package environment

import (
	"encoding/json"
	"math"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestUsageValidation(t *testing.T) {
	for _, u := range []*Usage{nil, {At: time.Now(), CPUCores: new(0.0)}, {At: time.Now(), MemoryBytes: new(uint64(0))}} {
		if !u.valid() {
			t.Fatal("有效采样被拒绝", u)
		}
	}
	for _, u := range []*Usage{{}, {At: time.Now()}, {At: time.Now(), CPUCores: new(-1.0)}, {At: time.Now(), CPUCores: new(math.Inf(1))}, {At: time.Now(), CPUCores: new(math.NaN())}, {At: time.Now().Add(time.Hour), CPUCores: new(1.0)}} {
		if u.valid() {
			t.Fatal("无效采样被接受", u)
		}
	}
}

func TestUsageViewFreshness(t *testing.T) {
	u := Usage{At: time.Now().Add(-2 * time.Minute), CPUCores: new(0.25)}
	raw, _ := json.Marshal(u)
	e := sqlc.Environment{Desired: "running", Phase: "running", Generation: 1, ObservedGeneration: 1, Usage: raw}
	if got := view(e); got.Usage == nil || !got.UsageStale {
		t.Fatal("旧样本必须保留采样时间并标记过期", got)
	}
	e.Generation = 2
	if got := view(e); got.Usage != nil || got.UsageStale {
		t.Fatal("新代次不能沿用旧样本", got)
	}
}

func TestUsageLifecycle(t *testing.T) {
	s, user, host, _ := fixture(t)
	ctx := t.Context()
	created, err := s.Create(ctx, user, Creation{"占用采集", "usage"})
	if err != nil {
		t.Fatal(err)
	}
	o := observe(created.Environment, "running")
	o.Usage = &Usage{At: time.Now().UTC(), CPUCores: new(0.25), MemoryBytes: new(uint64(128 << 20))}
	if syncState(t, s, host, o).UsageProtocol != 1 {
		t.Fatal("未声明采集协议")
	}
	read := func() View {
		t.Helper()
		w := httptest.NewRecorder()
		s.list(true)(w, httptest.NewRequest("GET", "/environments", nil))
		var result struct {
			Items []View `json:"items"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || len(result.Items) != 1 {
			t.Fatal(w.Code, w.Body.String())
		}
		return result.Items[0]
	}
	if got := read(); got.Usage == nil || *got.Usage.CPUCores != 0.25 || *got.Usage.MemoryBytes != 128<<20 {
		t.Fatal("列表丢失占用", got)
	}
	row, err := sqlc.New(s.pool).GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: o.EnvironmentID, UserID: &user})
	if err != nil {
		t.Fatal(err)
	}
	if got, err := s.environmentView(ctx, row); err != nil || got.Usage == nil {
		t.Fatal("详情丢失占用", got, err)
	}
	raw, _ := json.Marshal(Exchange{Protocol: 1, Results: []Observation{o}})
	if _, err := s.Exchange(ctx, resource.ID(), raw); err == nil {
		t.Fatal("接受跨宿主采样")
	}
	// 重复迁移不能清掉已采集的数据。
	migration, err := os.ReadFile("../../migrations/000044_environment_usage.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := s.pool.Exec(ctx, string(migration)); err != nil {
			t.Fatal(err)
		}
	}
	if read().Usage == nil {
		t.Fatal("迁移清除了采样")
	}
	stopped, err := s.Change(ctx, &user, o.EnvironmentID, "stopped", Change{1, "usage-stop"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, o)
	if read().Usage != nil {
		t.Fatal("旧实例采样污染新代次")
	}
	syncState(t, s, host, observe(stopped.Environment, "stopped"))
	started, err := s.Change(ctx, &user, o.EnvironmentID, "running", Change{2, "usage-start"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(started.Environment, "running"))
	if read().Usage != nil {
		t.Fatal("旧 engine 缺少采样时应省略")
	}
}
