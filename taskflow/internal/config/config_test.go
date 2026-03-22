package config

import (
	"os"
	"testing"
)

func TestLoad(t *testing.T) {
	content := `
server:
  http_addr: ":9090"
  grpc_addr: ":50052"
redis:
  addr: "localhost:6380"
  password: "test"
  db: 1
log:
  level: "debug"
`
	tmpFile, err := os.CreateTemp("", "config-*.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	tmpFile.Close()

	cfg, err := Load(tmpFile.Name())
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	if cfg.Server.HTTPAddr != ":9090" {
		t.Errorf("expected HTTPAddr :9090, got %s", cfg.Server.HTTPAddr)
	}
	if cfg.Server.GRPCAddr != ":50052" {
		t.Errorf("expected GRPCAddr :50052, got %s", cfg.Server.GRPCAddr)
	}
	if cfg.Redis.Addr != "localhost:6380" {
		t.Errorf("expected Redis.Addr localhost:6380, got %s", cfg.Redis.Addr)
	}
	if cfg.Redis.Password != "test" {
		t.Errorf("expected Redis.Password test, got %s", cfg.Redis.Password)
	}
	if cfg.Redis.DB != 1 {
		t.Errorf("expected Redis.DB 1, got %d", cfg.Redis.DB)
	}
	if cfg.Log.Level != "debug" {
		t.Errorf("expected Log.Level debug, got %s", cfg.Log.Level)
	}
}

func TestLoadDefaults(t *testing.T) {
	content := `
server:
  http_addr: ""
  grpc_addr: ""
`
	tmpFile, err := os.CreateTemp("", "config-*.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	tmpFile.Close()

	cfg, err := Load(tmpFile.Name())
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	if cfg.Server.HTTPAddr != ":8888" {
		t.Errorf("expected default HTTPAddr :8888, got %s", cfg.Server.HTTPAddr)
	}
	if cfg.Server.GRPCAddr != ":50051" {
		t.Errorf("expected default GRPCAddr :50051, got %s", cfg.Server.GRPCAddr)
	}
	if cfg.Redis.Addr != "localhost:6379" {
		t.Errorf("expected default Redis.Addr localhost:6379, got %s", cfg.Redis.Addr)
	}
	if cfg.Log.Level != "info" {
		t.Errorf("expected default Log.Level info, got %s", cfg.Log.Level)
	}
}
