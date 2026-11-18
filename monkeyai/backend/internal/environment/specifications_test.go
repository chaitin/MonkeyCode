package environment

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func specificationRequest(t *testing.T, s *Service, method string, body any, want int) SpecificationCatalog {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(method, "/environment-specifications", bytes.NewReader(raw))
	w := httptest.NewRecorder()
	if method == http.MethodGet {
		s.getSpecifications(w, r)
	} else {
		s.putSpecifications(w, r)
	}
	if w.Code != want || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("规格接口返回 %d，期望 %d：%s", w.Code, want, w.Body.String())
	}
	var out SpecificationCatalog
	if want == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if out.Items == nil {
			t.Fatal("空目录必须返回空数组，不能为 null")
		}
	}
	return out
}

func requireSpecificationFailure(t *testing.T, err error, code string) {
	t.Helper()
	var f *failure
	if !errors.As(err, &f) || f.code != code {
		t.Fatalf("期望 %s，实际 %v", code, err)
	}
}

func TestSpecificationCatalogStartsWithDefaultAndValidatesUpdates(t *testing.T) {
	s := NewService(pool(t))
	initial := specificationRequest(t, s, http.MethodGet, nil, 200)
	if initial.Revision != 0 || len(initial.Items) != 1 || initial.Items[0].CPUMillis != 1000 || initial.Items[0].MemoryBytes != 2<<30 || initial.Items[0].Version != 1 {
		t.Fatal("初始目录应仅包含 1 核 2 GB 规格", initial)
	}
	first := Specification{ID: resource.ID(), CPUMillis: 2000, MemoryBytes: 4 << 30}
	second := Specification{ID: resource.ID(), CPUMillis: 4000, MemoryBytes: 8 << 30}
	for _, body := range []any{
		map[string]any{"items": []Specification{}},
		map[string]any{"revision": 0},
		map[string]any{"revision": 0, "items": nil},
		SpecificationCatalog{Items: []Specification{first, first}},
		SpecificationCatalog{Items: []Specification{first, {ID: resource.ID(), CPUMillis: first.CPUMillis, MemoryBytes: first.MemoryBytes}}},
		SpecificationCatalog{Items: []Specification{{ID: resource.ID(), CPUMillis: 99, MemoryBytes: 4 << 30}}},
		SpecificationCatalog{Items: []Specification{{ID: resource.ID(), CPUMillis: 1000, MemoryBytes: 1}}},
		SpecificationCatalog{Items: make([]Specification, 101)},
	} {
		specificationRequest(t, s, http.MethodPut, body, 400)
	}

	saved := specificationRequest(t, s, http.MethodPut, SpecificationCatalog{Items: []Specification{first, second}}, 200)
	if saved.Revision != 1 || len(saved.Items) != 2 || saved.Items[0].Version != 1 {
		t.Fatal(saved)
	}
	specificationRequest(t, s, http.MethodPut, SpecificationCatalog{Items: []Specification{}}, 409)
	stale := saved
	stale.Items = append([]Specification(nil), saved.Items...)
	stale.Items[0].Version = 0
	specificationRequest(t, s, http.MethodPut, stale, 409)
	unchanged := specificationRequest(t, s, http.MethodGet, nil, 200)
	if len(unchanged.Items) != 2 || unchanged.Revision != saved.Revision {
		t.Fatal("失败更新未原子回滚", unchanged)
	}
	reordered := specificationRequest(t, s, http.MethodPut, SpecificationCatalog{Revision: 1, Items: []Specification{saved.Items[1], saved.Items[0]}}, 200)
	if reordered.Revision != 2 || reordered.Items[0].ID != second.ID || reordered.Items[0].Version != 1 {
		t.Fatal("重排改变条目版本", reordered)
	}
	empty := specificationRequest(t, s, http.MethodPut, SpecificationCatalog{Revision: 2, Items: []Specification{}}, 200)
	specificationRequest(t, s, http.MethodPut, SpecificationCatalog{Revision: empty.Revision, Items: []Specification{first}}, 409)
	if len(specificationRequest(t, s, http.MethodGet, nil, 200).Items) != 0 {
		t.Fatal("复用了已删除 ID")
	}
}

func TestSpecificationChangesPreserveSnapshotsReplaysAndRestarts(t *testing.T) {
	s, user, host := fixture(t)
	ctx := t.Context()
	// 宿主资源预设不再参与目录展示或新建准入。
	if _, err := s.pool.Exec(ctx, "UPDATE host_environment_configs SET resource=NULL WHERE host_id=$1", host); err != nil {
		t.Fatal(err)
	}
	in := Creation{SpecificationSelection: testSpecification(), Name: "原规格", RequestKey: "spec-original"}
	created, err := s.CreateOnHost(ctx, user, host, in)
	if err != nil {
		t.Fatal(err)
	}
	q := sqlc.New(s.pool)
	before, err := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: created.Environment.ID})
	if err != nil {
		t.Fatal(err)
	}
	catalog := specificationRequest(t, s, http.MethodGet, nil, 200)
	for i := range catalog.Items {
		if catalog.Items[i].ID == in.SpecificationID {
			catalog.Items[i].CPUMillis = 2500
			catalog.Items[i].MemoryBytes = 1 << 30
		}
	}
	catalog = specificationRequest(t, s, http.MethodPut, catalog, 200)
	var version int64
	for _, item := range catalog.Items {
		if item.ID == in.SpecificationID {
			version = item.Version
		}
	}
	if version != 2 {
		t.Fatal("修改资源未推进版本", catalog)
	}
	replay, err := s.CreateOnHost(ctx, user, host, in)
	if err != nil || replay.Environment.ID != created.Environment.ID || replay.Operation.ID != created.Operation.ID {
		t.Fatal("规格修改破坏重试", err)
	}
	stale := in
	stale.RequestKey = "spec-stale"
	_, err = s.CreateOnHost(ctx, user, host, stale)
	requireSpecificationFailure(t, err, "specification_changed")
	next := in
	next.SpecificationVersion = version
	_, err = s.CreateOnHost(ctx, user, host, next)
	requireSpecificationFailure(t, err, "idempotency_conflict")
	next.RequestKey = "spec-new"
	newEnvironment, err := s.CreateOnHost(ctx, user, host, next)
	if err != nil {
		t.Fatal(err)
	}
	newRow, err := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: newEnvironment.Environment.ID})
	if err != nil || newRow.CpuMillis != 2500 || newRow.MemoryBytes != 1<<30 {
		t.Fatal("新建未使用所选资源", err, newRow)
	}
	specificationRequest(t, s, http.MethodPut, SpecificationCatalog{Revision: catalog.Revision, Items: []Specification{}}, 200)
	replay, err = s.CreateOnHost(ctx, user, host, in)
	if err != nil || replay.Environment.ID != created.Environment.ID {
		t.Fatal("规格删除破坏重试", err)
	}
	next.RequestKey = "spec-deleted"
	_, err = s.CreateOnHost(ctx, user, host, next)
	requireSpecificationFailure(t, err, "specification_unavailable")
	_, err = s.Create(ctx, user, Creation{Name: "缺少规格", RequestKey: "missing-spec"})
	requireSpecificationFailure(t, err, "invalid_request")
	stopped, err := s.Change(ctx, &user, created.Environment.ID, "stopped", Change{Generation: 1, RequestKey: "stop-spec"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(stopped.Environment, "stopped"))
	if _, err = s.Change(ctx, &user, created.Environment.ID, "running", Change{Generation: 2, RequestKey: "restart-spec"}); err != nil {
		t.Fatal("删除规格阻止旧实例重启", err)
	}
	after, err := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: created.Environment.ID})
	if err != nil || before.CpuMillis != after.CpuMillis || before.MemoryBytes != after.MemoryBytes {
		t.Fatal("旧实例资源被改写", err)
	}
	beforeSpec, err := executionSpec(before)
	if err != nil {
		t.Fatal(err)
	}
	afterSpec, err := executionSpec(after)
	if err != nil || beforeSpec.Resource != afterSpec.Resource {
		t.Fatal("重启丢失完整资源快照", err)
	}
}

func TestHostSetupRejectsPerHostResources(t *testing.T) {
	s, _, host, setup := setupFixture(t)
	raw, err := json.Marshal(setup)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err = json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	body["resource"] = profile().Resource
	raw, err = json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPut, "/environment-hosts/"+host+"/setup", bytes.NewReader(raw))
	rec := httptest.NewRecorder()
	s.putSetup(rec, req)
	if rec.Code != 400 {
		t.Fatal("仍接受宿主规格", rec.Code, rec.Body.String())
	}
}
