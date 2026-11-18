package environment

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/go-chi/chi/v5"
)

func setupFixture(t *testing.T) (*Service, string, string, Setup) {
	t.Helper()
	s, user, host := fixture(t)
	return s, user, host, Setup{}
}
func TestSetupKeepsSnapshots(t *testing.T) {
	s, user, host, in := setupFixture(t)
	ctx := t.Context()
	q := sqlc.New(s.pool)
	if _, err := s.saveSetup(ctx, host, in); err != nil {
		t.Fatal(err)
	}
	created, err := s.Create(ctx, user, Creation{testSpecification(), "original", "setup-before"})
	if err != nil {
		t.Fatal(err)
	}
	before, err := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: created.Environment.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.saveSetup(ctx, host, in); err != nil {
		t.Fatal(err)
	}
	after, err := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: created.Environment.ID})
	if err != nil || after.CpuMillis != 1000 || !bytes.Equal(before.Spec, after.Spec) {
		t.Fatal("配置改变已有环境", err)
	}
	current, err := q.HostSetup(ctx, host)
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if json.Unmarshal(current.Resource, &stored) != nil || len(stored) != 4 || stored["image"] != nil {
		t.Fatal("保存了额外资源字段", stored)
	}
	raw, err := os.ReadFile("../../migrations/000040_cloud_environments.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err = s.pool.Exec(ctx, string(raw)); err != nil {
			t.Fatal(err)
		}
	}
	replay, err := q.HostSetup(ctx, host)
	if err != nil || !bytes.Equal(replay.Resource, current.Resource) {
		t.Fatal("重放覆盖配置", err)
	}
}
func TestSetupSavesPreserveEnvironments(t *testing.T) {
	s, user, host, in := setupFixture(t)
	ctx := t.Context()
	for _, key := range []string{"a", "b"} {
		if _, err := s.Create(ctx, user, Creation{testSpecification(), key, key}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.saveSetup(ctx, host, in); err != nil {
		t.Fatal("保存不应删除已有环境", err)
	}
	if _, err := s.Create(ctx, user, Creation{testSpecification(), "allowed", "allowed"}); err != nil {
		t.Fatal("保存后应允许继续创建", err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		wg.Go(func() { _, err := s.saveSetup(ctx, host, in); errs <- err })
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal("配置不再使用版本冲突", err)
		}
	}
	out, err := s.saveSetup(ctx, host, in)
	if err != nil || out.HostID != host {
		t.Fatal("最后提交未生效", err)
	}
	used, err := sqlc.New(s.pool).HostUsage(ctx, host)
	if err != nil || used != 3 {
		t.Fatal("保存改变了已有环境", used, err)
	}
}
func TestSetupRoutesAndValidation(t *testing.T) {
	s, _, host, in := setupFixture(t)
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	get := httptest.NewRecorder()
	router.ServeHTTP(get, httptest.NewRequest("GET", "/environment-hosts/"+host+"/setup", nil))
	if get.Code != 200 || get.Header().Get("Cache-Control") != "no-store" || strings.Contains(get.Body.String(), `"revision"`) {
		t.Fatal(get.Code, get.Body.String())
	}
	for _, body := range []string{`{"max_environments":1}`, `{"max_environments":0}`} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("PUT", "/environment-hosts/"+host+"/setup", strings.NewReader(body)))
		if rec.Code != 400 {
			t.Fatal(rec.Code, rec.Body.String())
		}
	}
	raw, _ := json.Marshal(in)
	body := strings.TrimSuffix(string(raw), "}") + `,"revision":1}`
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest("PUT", "/environment-hosts/"+host+"/setup", strings.NewReader(body)))
	if rec.Code != 400 {
		t.Fatal("仍接受配置版本", rec.Code)
	}
	s.images = nil
	out, err := s.saveSetup(t.Context(), host, in)
	if err != nil || out.ImageReady || out.ImageReason == "" {
		t.Fatal("镜像未准备时应允许保存并显示原因", err)
	}
}
