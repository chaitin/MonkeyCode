package app

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/jackc/pgx/v5/pgxpool"
)

func designAppDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("需要专用 PostgreSQL/S3 测试环境")
	}
	root, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "design_app_" + strings.ReplaceAll(uuid.New().String(), "-", "")
	if _, err = root.Exec(t.Context(), "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pool.Close(); root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); root.Close() })
	files, _ := filepath.Glob("../../migrations/*.up.sql")
	for _, name := range files {
		b, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(t.Context(), string(b)); err != nil {
			t.Fatal(err)
		}
	}
	return pool
}

func TestOwnedDesignDevice(t *testing.T) {
	pool := designAppDatabase(t)
	user, other, machine := uuid.New().String(), uuid.New().String(), uuid.New().String()
	for i, id := range []string{user, other} {
		if _, err := pool.Exec(t.Context(), "INSERT INTO users(id,name,email,role) VALUES($1,'device',$2,'user')", id, []string{"design-owner@example.com", "design-other@example.com"}[i]); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(t.Context(), "INSERT INTO endpoints(user_id,machine_id,device_name,platform,os_version,arch,client_version,protocol_version) VALUES($1,$2,'design','macos','15','arm64','1',1)", user, machine); err != nil {
		t.Fatal(err)
	}
	owner := designDevices{endpoint.NewPostgres(pool)}
	if got, err := owner.OwnedDevice(t.Context(), user, machine); err != nil || got != machine {
		t.Fatal("本用户设备被拒绝", err)
	}
	if _, err := owner.OwnedDevice(t.Context(), user, "invalid-machine-id"); err == nil {
		t.Fatal("非法设备ID被接受")
	}
	if _, err := owner.OwnedDevice(t.Context(), other, machine); err == nil {
		t.Fatal("其他用户设备被接受")
	}
	if _, err := pool.Exec(t.Context(), "UPDATE endpoints SET status='revoked',revoked_at=now() WHERE user_id=$1 AND machine_id=$2", user, machine); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.OwnedDevice(t.Context(), user, machine); err == nil {
		t.Fatal("移除设备被接受")
	}
}

func TestDesignRoute(t *testing.T) {
	pool := designAppDatabase(t)
	handler, err := newMemberTestHandler(t.Context(), slog.New(slog.NewTextHandler(io.Discard, nil)), pool, config.Config{PublicURL: "http://localhost:8080"})
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/v1/design-resources/config", "/api/v1/design-resources/catalog/snapshot", "/api/v1/design-resources/catalog/templates", "/api/v1/design-resources/design-systems/demo/download"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != 401 {
			t.Fatalf("新增路由未挂载 %s: %d %s", path, w.Code, w.Body.String())
		}
		if strings.Contains(path, "/catalog/") && !strings.Contains(w.Body.String(), `"code":"unauthorized"`) {
			t.Fatal("资源认证信封未转换")
		}
	}
}
