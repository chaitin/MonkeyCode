package environment

import (
	"encoding/json"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestListFilters(t *testing.T) {
	for _, query := range []string{"?status=bad", "?sort=cpu", "?sort=memory_desc;DROP"} {
		if _, _, err := listFilters(httptest.NewRequest("GET", "/environments"+query, nil)); err == nil {
			t.Fatal("接受无效筛选", query)
		}
	}
	status, sort, err := listFilters(httptest.NewRequest("GET", "/environments", nil))
	if err != nil || status != "active" || sort != "newest" {
		t.Fatal(status, sort, err)
	}
}

func TestListStatusAndUsageOrdering(t *testing.T) {
	s, user, host, preset := fixture(t)
	ctx := t.Context()
	q := sqlc.New(s.pool)
	now := time.Now().UTC()
	type sample struct {
		name, desired, phase string
		generation           int64
		cpu, memory          int
		at                   time.Time
	}
	for _, item := range []sample{
		{"小", "running", "running", 1, 1, 300, now},
		{"大", "running", "running", 1, 2, 100, now},
		{"零", "running", "running", 1, 0, 0, now},
		{"过期", "running", "running", 1, 100, 900, now.Add(-2 * time.Minute)},
		{"缺失", "running", "running", 1, 0, 0, time.Time{}},
		{"已删除", "deleted", "deleted", 1, 0, 0, time.Time{}},
		{"删除失败", "deleted", "failed", 1, 0, 0, time.Time{}},
		{"等待删除", "deleted", "running", 2, 99, 999, now},
		{"已停止", "stopped", "stopped", 1, 0, 0, time.Time{}},
	} {
		id := resource.ID()
		spec, _ := json.Marshal(map[string]any{"resource": profile().Resource})
		_, err := q.CreateEnvironment(ctx, sqlc.CreateEnvironmentParams{ID: id, UserID: user, HostID: host, PresetID: preset, Name: item.name, InstanceID: resource.ID(), Spec: spec, CpuMillis: 1000, MemoryBytes: 512 << 20, RequestKey: id, RequestHash: id})
		if err != nil {
			t.Fatal(err)
		}
		var usage []byte
		if !item.at.IsZero() {
			usage, _ = json.Marshal(Usage{At: item.at, CPUCores: new(float64(item.cpu)), MemoryBytes: new(uint64(item.memory))})
		}
		_, err = s.pool.Exec(ctx, `UPDATE environments SET desired=$2,phase=$3,generation=$4,observed_generation=1,observed_at=now(),usage=$5,created_at=$6 WHERE id=$1`, id, item.desired, item.phase, item.generation, usage, now)
		if err != nil {
			t.Fatal(err)
		}
	}
	list := func(query string) []string {
		t.Helper()
		w := httptest.NewRecorder()
		s.list(true)(w, httptest.NewRequest("GET", "/environments"+query, nil))
		var result struct {
			Items []View `json:"items"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
			t.Fatal(w.Code, w.Body.String())
		}
		names := make([]string, len(result.Items))
		for i, e := range result.Items {
			names[i] = e.Name
		}
		return names
	}
	for _, tc := range []struct {
		query string
		want  []string
	}{
		{"?status=deleted", []string{"已删除"}},
		{"?status=failed", []string{"删除失败"}},
		{"?status=pending_deleted", []string{"等待删除"}},
		{"?status=stopped", []string{"已停止"}},
		{"?sort=cpu_desc&page_size=2", []string{"大", "小"}},
		{"?sort=cpu_asc&page_size=2", []string{"零", "小"}},
		{"?sort=memory_desc&page_size=2", []string{"小", "大"}},
		{"?sort=memory_asc&page_size=2", []string{"零", "大"}},
		{"?sort=cpu_desc&page_size=1&page=3", []string{"零"}},
	} {
		if got := list(tc.query); !slices.Equal(got, tc.want) {
			t.Fatalf("%s: %v != %v", tc.query, got, tc.want)
		}
	}
	if got := list(""); len(got) != 8 || slices.Contains(got, "已删除") {
		t.Fatal("默认筛选错误", got)
	}
	if got := list("?status=all"); len(got) != 9 {
		t.Fatal("全部状态丢失记录", got)
	}
	if got := list("?status=running"); len(got) != 5 || slices.Contains(got, "等待删除") {
		t.Fatal("状态未按代次解析", got)
	}
	first := list("?sort=cpu_desc&page_size=100")
	if !slices.Equal(first, list("?sort=cpu_desc&page_size=100")) {
		t.Fatal("相同指标排序不稳定")
	}
	rows, err := q.ListEnvironments(ctx, sqlc.ListEnvironmentsParams{UserID: new(resource.ID()), Status: "all", Sort: "cpu_desc", Limit: 100})
	if err != nil || len(rows) != 0 {
		t.Fatal("筛选泄露其他用户环境", rows, err)
	}
}
