package environment

import (
	"encoding/json"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestHostFilterBeforeStatusSortingAndPagination(t *testing.T) {
	s, user, host := fixture(t)
	ctx := t.Context()
	other := resource.ID()
	otherUser := resource.ID()
	if _, err := s.pool.Exec(ctx, `INSERT INTO hosts(id,user_id,name,architecture,version) VALUES($1,$2,'other','amd64','v1')`, other, user); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1::uuid,'other',$1::text || '@example.com')`, otherUser); err != nil {
		t.Fatal(err)
	}
	q := sqlc.New(s.pool)
	for i, sample := range []struct {
		host, user, name, phase string
		cpu                     int
	}{
		{other, user, "其他宿主", "running", 100}, {host, user, "本机低", "running", 1}, {host, otherUser, "本机高", "running", 2}, {host, user, "本机停止", "stopped", 3},
	} {
		id := resource.ID()
		spec, _ := json.Marshal(map[string]any{"resource": profile().Resource})
		if _, err := q.CreateEnvironment(ctx, sqlc.CreateEnvironmentParams{ID: id, UserID: sample.user, HostID: sample.host, Name: sample.name, InstanceID: resource.ID(), Spec: spec, CpuMillis: 1000, MemoryBytes: 512 << 20}); err != nil {
			t.Fatal(err)
		}
		if err := q.CreateRuntime(ctx, id); err != nil {
			t.Fatal(err)
		}
		if _, err := s.pool.Exec(ctx, `UPDATE environments SET phase=$2,desired=CASE WHEN $2='stopped' THEN 'stopped' ELSE 'running' END,observed_generation=1,usage=jsonb_build_object('at',now(),'cpu_cores',$3::int),created_at=now()+$4*interval '1 second' WHERE id=$1`, id, sample.phase, sample.cpu, i); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		query string
		want  []string
	}{
		{"?host_id=" + host + "&sort=cpu_desc&page_size=1", []string{"本机高"}},
		{"?host_id=" + host + "&sort=cpu_desc&page_size=1&page=2", []string{"本机低"}},
		{"?host_id=" + host + "&status=stopped", []string{"本机停止"}},
		{"?host_id=" + other, []string{"其他宿主"}},
		{"?host_id=" + resource.ID(), []string{}},
	} {
		w := httptest.NewRecorder()
		s.list(true)(w, httptest.NewRequest("GET", "/environments"+tc.query, nil))
		var list struct {
			Items []View `json:"items"`
		}
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &list) != nil {
			t.Fatal(w.Code, w.Body)
		}
		names := make([]string, len(list.Items))
		for i, env := range list.Items {
			names[i] = env.Name
		}
		if !slices.Equal(names, tc.want) {
			t.Fatalf("%s: %v != %v", tc.query, names, tc.want)
		}
	}
	rows, err := q.ListEnvironments(ctx, sqlc.ListEnvironmentsParams{UserID: &user, HostID: &host, Status: "all", Sort: "newest", Limit: 100})
	if err != nil || len(rows) != 2 {
		t.Fatal("宿主筛选破坏owner约束", len(rows), err)
	}
	for _, query := range []string{"?host_id=not-a-uuid", "?host_id=", "?host_id=" + host + "&host_id=" + other} {
		w := httptest.NewRecorder()
		s.list(true)(w, httptest.NewRequest("GET", "/environments"+query, nil))
		if w.Code != 400 {
			t.Fatal("无效宿主筛选未返回400", w.Code, w.Body)
		}
	}
}
