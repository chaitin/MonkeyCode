package clickhouse

import (
	"context"
	"database/sql"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4/source"
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

func TestNormalizeModelUsageTableDefaults(t *testing.T) {
	table, err := NormalizeModelUsageTable("")
	if err != nil {
		t.Fatal(err)
	}
	if table != ModelUsageTable {
		t.Fatalf("table = %q, want %s", table, ModelUsageTable)
	}
}

func TestNormalizeModelUsageTableRejectsUnsafeName(t *testing.T) {
	_, err := NormalizeModelUsageTable("model_usage_events; DROP TABLE task_logs")
	if err == nil {
		t.Fatal("expected unsafe model usage table name error")
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

func TestBuildBootstrapDSNOmitsDatabase(t *testing.T) {
	dsn, err := buildBootstrapDSN(config.ClickHouse{
		Addr:     "chproxy:9000",
		Database: "monkeycode-ai",
		Username: "mc_writer",
		Password: "writer-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	if dsn != "clickhouse://mc_writer:writer-secret@chproxy:9000" {
		t.Fatalf("dsn = %q, want DSN without database", dsn)
	}
}

func TestBuildBootstrapDSNUsesWriteCredentials(t *testing.T) {
	dsn, err := buildBootstrapDSN(config.ClickHouse{
		Addr:         "chproxy:9000",
		Database:     "monkeycode-ai",
		Username:     "mc_writer",
		Password:     "writer-secret",
		ReadUsername: "mc_reader",
		ReadPassword: "reader-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	if dsn != "clickhouse://mc_writer:writer-secret@chproxy:9000" {
		t.Fatalf("dsn = %q, want write credentials", dsn)
	}
}

func TestShouldInitSchemaDefaultsToFalse(t *testing.T) {
	if shouldInitSchema(config.ClickHouse{}) {
		t.Fatal("expected clickhouse schema init disabled by default")
	}
}

func TestShouldInitSchemaUsesConfigSwitch(t *testing.T) {
	if !shouldInitSchema(config.ClickHouse{InitEnabled: true}) {
		t.Fatal("expected clickhouse schema init enabled")
	}
}

func TestQuoteIdentifierEscapesDatabaseName(t *testing.T) {
	identifier, err := quoteIdentifier("monkeycode-ai")
	if err != nil {
		t.Fatal(err)
	}
	if identifier != "`monkeycode-ai`" {
		t.Fatalf("identifier = %q, want `monkeycode-ai`", identifier)
	}
}

func TestBuildSingleMigrationSourceUsesConfiguredTables(t *testing.T) {
	source, err := newSingleMigrationSource("task_logs_test", "model_usage_events_test")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = source.Close() })
	first, err := source.First()
	if err != nil {
		t.Fatal(err)
	}
	body, _, err := source.ReadUp(first)
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	data, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	query := string(data)
	if !strings.Contains(query, "CREATE TABLE IF NOT EXISTS `task_logs_test`") {
		t.Fatalf("query = %q, want configured task log table", query)
	}
	if strings.Contains(query, "ON CLUSTER") || strings.Contains(query, "ReplicatedMergeTree") {
		t.Fatalf("single migration query contains cluster ddl:\n%s", query)
	}
}

func TestBuildSingleMigrationSourceIncludesModelUsageCachedTokens(t *testing.T) {
	source, err := newSingleMigrationSource("task_logs_test", "model_usage_events_test")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = source.Close() })
	next, err := source.Next(1)
	if err != nil {
		t.Fatal(err)
	}
	body, _, err := source.ReadUp(next)
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	data, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	query := string(data)
	for _, want := range []string{
		"CREATE TABLE IF NOT EXISTS `model_usage_events_test`",
		"team_id String",
		"user_id String",
		"task_id String",
		"project_id String",
		"cached_tokens UInt64",
		"ORDER BY (team_id, event_time, user_id, task_id, model_id)",
	} {
		if !strings.Contains(query, want) {
			t.Fatalf("query missing %q:\n%s", want, query)
		}
	}
}

func TestBuildMigrationSourcesUseUTCDateTimeColumns(t *testing.T) {
	tests := []struct {
		name string
		new  func() (source.Driver, error)
	}{
		{
			name: "single",
			new: func() (source.Driver, error) {
				return newSingleMigrationSource("task_logs_test", "model_usage_events_test")
			},
		},
		{
			name: "cluster",
			new: func() (source.Driver, error) {
				return newClusterMigrationSource("task_logs_test", "model_usage_events_test")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			source, err := tt.new()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = source.Close() })

			for version := uint(1); version <= 2; version++ {
				body, _, err := source.ReadUp(version)
				if err != nil {
					t.Fatal(err)
				}
				data, err := io.ReadAll(body)
				_ = body.Close()
				if err != nil {
					t.Fatal(err)
				}
				query := string(data)
				if strings.Contains(query, "Asia/Shanghai") {
					t.Fatalf("migration %d uses non-UTC timezone:\n%s", version, query)
				}
			}

			body, _, err := source.ReadUp(1)
			if err != nil {
				t.Fatal(err)
			}
			taskLogData, err := io.ReadAll(body)
			_ = body.Close()
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(taskLogData), "ts DateTime64(9, 'UTC')") {
				t.Fatalf("task log migration missing UTC ts:\n%s", string(taskLogData))
			}

			body, _, err = source.ReadUp(2)
			if err != nil {
				t.Fatal(err)
			}
			modelUsageData, err := io.ReadAll(body)
			_ = body.Close()
			if err != nil {
				t.Fatal(err)
			}
			query := string(modelUsageData)
			for _, want := range []string{
				"event_time DateTime64(3, 'UTC')",
				"created_at DateTime64(3, 'UTC') DEFAULT now64(3, 'UTC')",
			} {
				if !strings.Contains(query, want) {
					t.Fatalf("model usage migration missing %q:\n%s", want, query)
				}
			}
		})
	}
}

func TestClusterMigrationSourceKeepsClusterDDL(t *testing.T) {
	source, err := newClusterMigrationSource("task_logs", "model_usage_events")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = source.Close() })
	first, err := source.First()
	if err != nil {
		t.Fatal(err)
	}
	body, _, err := source.ReadUp(first)
	if err != nil {
		t.Fatal(err)
	}
	defer body.Close()
	data, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	query := string(data)
	if !strings.Contains(query, "ON CLUSTER mcai_cluster") || !strings.Contains(query, "ReplicatedMergeTree") {
		t.Fatalf("cluster migration query missing cluster ddl:\n%s", query)
	}
}

func TestInsertModelUsageEventWritesCachedTokens(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`CREATE TABLE model_usage_events_test (
		event_time timestamp,
		team_id text,
		user_id text,
		task_id text,
		project_id text,
		provider text,
		model_id text,
		model_name text,
		input_tokens integer,
		output_tokens integer,
		cached_tokens integer,
		total_tokens integer,
		request_count integer,
		success integer,
		duration_ms integer,
		trace_id text,
		request_id text,
		source text
	)`)
	if err != nil {
		t.Fatal(err)
	}
	client := NewWithDBTables(db, "task_logs_test", "model_usage_events_test")
	event := ModelUsageEvent{
		EventTime:    time.Date(2026, 6, 4, 19, 0, 0, 0, time.UTC),
		TeamID:       "team-1",
		UserID:       "user-1",
		TaskID:       "task-1",
		ProjectID:    "project-1",
		Provider:     "openai",
		ModelID:      "model-1",
		ModelName:    "gpt-4o",
		InputTokens:  100,
		OutputTokens: 40,
		CachedTokens: 25,
		TotalTokens:  140,
		RequestCount: 1,
		Success:      true,
		DurationMS:   1234,
		TraceID:      "trace-1",
		RequestID:    "request-1",
		Source:       "runtime",
	}
	if err := client.InsertModelUsageEvent(context.Background(), event); err != nil {
		t.Fatal(err)
	}
	var cached int64
	if err := db.QueryRow("SELECT cached_tokens FROM model_usage_events_test WHERE request_id = ?", "request-1").Scan(&cached); err != nil {
		t.Fatal(err)
	}
	if cached != 25 {
		t.Fatalf("cached_tokens = %d, want 25", cached)
	}
}

func TestQueryModelUsageSummaryAggregatesByTeamAndTime(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`CREATE TABLE model_usage_events_test (
		event_time timestamp,
		team_id text,
		user_id text,
		task_id text,
		project_id text,
		model_id text,
		total_tokens integer,
		input_tokens integer,
		output_tokens integer,
		cached_tokens integer,
		request_count integer
	)`)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC)
	_, err = db.Exec(`INSERT INTO model_usage_events_test
		(event_time, team_id, user_id, task_id, project_id, model_id, total_tokens, input_tokens, output_tokens, cached_tokens, request_count)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		start.Add(time.Hour), "team-1", "user-1", "task-1", "", "m1", 100, 60, 40, 20, 1,
		start.Add(time.Hour), "team-2", "user-2", "task-2", "", "m1", 900, 500, 400, 0, 1,
	)
	if err != nil {
		t.Fatal(err)
	}
	client := NewWithDBTables(db, "task_logs_test", "model_usage_events_test")
	summary, err := client.QueryModelUsageSummary(context.Background(), ModelUsageQuery{
		TeamID: "team-1",
		Start:  start,
		End:    start.AddDate(0, 0, 1),
	})
	if err != nil {
		t.Fatal(err)
	}
	if summary.TotalTokens != 100 || summary.CachedTokens != 20 || summary.Requests != 1 {
		t.Fatalf("summary = %#v", summary)
	}
}

func TestQueryModelUsageTopUsersOrdersByTokens(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`CREATE TABLE model_usage_events_test (
		event_time timestamp,
		team_id text,
		user_id text,
		total_tokens integer,
		request_count integer
	)`)
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 6, 4, 0, 0, 0, 0, time.UTC)
	_, err = db.Exec(`INSERT INTO model_usage_events_test
		(event_time, team_id, user_id, total_tokens, request_count)
		VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
		start.Add(time.Hour), "team-1", "user-low", 100, 1,
		start.Add(time.Hour), "team-1", "user-high", 300, 2,
		start.Add(time.Hour), "team-2", "user-other", 900, 1,
	)
	if err != nil {
		t.Fatal(err)
	}
	client := NewWithDBTables(db, "task_logs_test", "model_usage_events_test")
	users, err := client.QueryModelUsageTopUsers(context.Background(), ModelUsageQuery{
		TeamID: "team-1",
		Start:  start,
		End:    start.AddDate(0, 0, 1),
	}, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(users) != 2 {
		t.Fatalf("top users length = %d, want 2", len(users))
	}
	if users[0].UserID != "user-high" || users[0].TotalTokens != 300 || users[0].Requests != 2 {
		t.Fatalf("first user = %#v", users[0])
	}
}
