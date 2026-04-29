package clickhouse

import (
	"database/sql"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/config"
)

func TestApplyPoolOptions(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	applyPoolOptions(db, config.ClickHouse{
		MaxOpenConns:    64,
		MaxIdleConns:    32,
		ConnMaxLifetime: 30,
	})

	stats := db.Stats()
	if stats.MaxOpenConnections != 64 {
		t.Fatalf("max open connections = %d, want 64", stats.MaxOpenConnections)
	}
}

func TestConnMaxLifetime(t *testing.T) {
	if got := connMaxLifetime(30); got != 30*time.Second {
		t.Fatalf("conn max lifetime = %s, want 30s", got)
	}
	if got := connMaxLifetime(0); got != 0 {
		t.Fatalf("zero conn max lifetime = %s, want 0", got)
	}
}

func TestNormalizeTableUsesConfiguredTable(t *testing.T) {
	table, err := NormalizeTable("task_logs_test")
	if err != nil {
		t.Fatal(err)
	}
	if table != "task_logs_test" {
		t.Fatalf("table = %q, want task_logs_test", table)
	}
}

func TestNormalizeTableDefaultsToTaskLogTable(t *testing.T) {
	table, err := NormalizeTable("")
	if err != nil {
		t.Fatal(err)
	}
	if table != TaskLogTable {
		t.Fatalf("table = %q, want %s", table, TaskLogTable)
	}
}

func TestNormalizeTableRejectsUnsafeTableName(t *testing.T) {
	_, err := NormalizeTable("task_logs; DROP TABLE task_logs")
	if err == nil {
		t.Fatal("expected unsafe table name error")
	}
}

func TestBuildDSNUsesSingleChproxyEndpoint(t *testing.T) {
	dsn, err := buildDSN(config.ClickHouse{
		Addr:         "chproxy:9000",
		Database:     "monkeycode",
		ReadUsername: "mc_reader",
		ReadPassword: "reader-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	if dsn != "clickhouse://mc_reader:reader-secret@chproxy:9000/monkeycode" {
		t.Fatalf("dsn = %q, want chproxy endpoint", dsn)
	}
}

func TestBuildDSNPreservesHTTPChproxyEndpoint(t *testing.T) {
	dsn, err := buildDSN(config.ClickHouse{
		Addr:         "http://chproxy:8123",
		Database:     "mcai",
		ReadUsername: "mc_reader",
		ReadPassword: "reader-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	if dsn != "http://mc_reader:reader-secret@chproxy:8123/mcai" {
		t.Fatalf("dsn = %q, want http chproxy endpoint", dsn)
	}
}

func TestBuildDSNFallsBackToLegacyCredentials(t *testing.T) {
	dsn, err := buildDSN(config.ClickHouse{
		Addr:     "chproxy:9000",
		Database: "monkeycode",
		Username: "legacy",
		Password: "legacy-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	if dsn != "clickhouse://legacy:legacy-secret@chproxy:9000/monkeycode" {
		t.Fatalf("dsn = %q, want legacy credentials", dsn)
	}
}
