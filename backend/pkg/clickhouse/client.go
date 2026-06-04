package clickhouse

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"strings"
	"time"

	_ "github.com/ClickHouse/clickhouse-go/v2"

	"github.com/chaitin/MonkeyCode/backend/config"
)

const (
	TaskLogTable    = "task_logs"
	ModelUsageTable = "model_usage_events"
)

var clickHouseIdentifierRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type Client struct {
	db              *sql.DB
	table           string
	modelUsageTable string
}

func New(cfg config.ClickHouse, logger *slog.Logger) (*Client, error) {
	if strings.TrimSpace(cfg.Addr) == "" {
		return nil, nil
	}
	table, err := NormalizeTable(cfg.Table)
	if err != nil {
		return nil, err
	}
	modelUsageTable, err := NormalizeModelUsageTable(cfg.ModelUsageTable)
	if err != nil {
		return nil, err
	}

	dsn, err := buildDSN(cfg)
	if err != nil {
		return nil, err
	}

	if err := initSchema(cfg); err != nil {
		return nil, err
	}

	db, err := sql.Open("clickhouse", dsn)
	if err != nil {
		return nil, err
	}
	applyPoolOptions(db, cfg)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	if logger != nil {
		logger.With("component", "clickhouse").Info("clickhouse connection established")
	}
	return NewWithDBTables(db, table, modelUsageTable), nil
}

func NewWithDB(db *sql.DB) *Client {
	return NewWithDBTables(db, TaskLogTable, ModelUsageTable)
}

func NewWithDBAndTable(db *sql.DB, table string) *Client {
	return NewWithDBTables(db, table, ModelUsageTable)
}

func NewWithDBTables(db *sql.DB, taskLogTable, modelUsageTable string) *Client {
	taskLogTable, err := NormalizeTable(taskLogTable)
	if err != nil {
		taskLogTable = TaskLogTable
	}
	modelUsageTable, err = NormalizeModelUsageTable(modelUsageTable)
	if err != nil {
		modelUsageTable = ModelUsageTable
	}
	return &Client{db: db, table: taskLogTable, modelUsageTable: modelUsageTable}
}

func (c *Client) Table() string {
	if c == nil || c.table == "" {
		return TaskLogTable
	}
	return c.table
}

func (c *Client) ModelUsageTable() string {
	if c == nil || c.modelUsageTable == "" {
		return ModelUsageTable
	}
	return c.modelUsageTable
}

func validateClickHouseIdentifier(name, label string) error {
	if !clickHouseIdentifierRE.MatchString(name) {
		return fmt.Errorf("invalid clickhouse %s: %q", label, name)
	}
	return nil
}

func NormalizeTable(table string) (string, error) {
	table = strings.TrimSpace(table)
	if table == "" {
		table = TaskLogTable
	}
	if err := validateClickHouseIdentifier(table, "table"); err != nil {
		return "", err
	}
	return table, nil
}

func NormalizeModelUsageTable(table string) (string, error) {
	table = strings.TrimSpace(table)
	if table == "" {
		table = ModelUsageTable
	}
	if err := validateClickHouseIdentifier(table, "model usage table"); err != nil {
		return "", err
	}
	return table, nil
}

func (c *Client) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return c.db.QueryContext(ctx, query, args...)
}

func (c *Client) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return c.db.QueryRowContext(ctx, query, args...)
}

func (c *Client) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return c.db.ExecContext(ctx, query, args...)
}

type ModelUsageEvent struct {
	EventTime    time.Time
	TeamID       string
	UserID       string
	TaskID       string
	ProjectID    string
	Provider     string
	ModelID      string
	ModelName    string
	InputTokens  uint64
	OutputTokens uint64
	CachedTokens uint64
	TotalTokens  uint64
	RequestCount uint64
	Success      bool
	DurationMS   uint64
	TraceID      string
	RequestID    string
	Source       string
}

type ModelUsageQuery struct {
	TeamID string
	Start  time.Time
	End    time.Time
}

type ModelUsageSummary struct {
	InputTokens  int64
	OutputTokens int64
	CachedTokens int64
	TotalTokens  int64
	Requests     int64
}

type ModelUsageTopUser struct {
	UserID      string
	TotalTokens int64
	Requests    int64
}

func (c *Client) InsertModelUsageEvent(ctx context.Context, event ModelUsageEvent) error {
	if c == nil || c.db == nil {
		return fmt.Errorf("clickhouse client is nil")
	}
	tableIdentifier, err := quoteIdentifier(c.ModelUsageTable())
	if err != nil {
		return err
	}
	success := uint8(0)
	if event.Success {
		success = 1
	}
	if event.RequestCount == 0 {
		event.RequestCount = 1
	}
	query := fmt.Sprintf(`INSERT INTO %s (
	event_time, team_id, user_id, task_id, project_id,
	provider, model_id, model_name,
	input_tokens, output_tokens, cached_tokens, total_tokens,
	request_count, success, duration_ms,
	trace_id, request_id, source
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, tableIdentifier)
	_, err = c.db.ExecContext(ctx, query,
		event.EventTime, event.TeamID, event.UserID, event.TaskID, event.ProjectID,
		event.Provider, event.ModelID, event.ModelName,
		event.InputTokens, event.OutputTokens, event.CachedTokens, event.TotalTokens,
		event.RequestCount, success, event.DurationMS,
		event.TraceID, event.RequestID, event.Source,
	)
	return err
}

func (c *Client) QueryModelUsageSummary(ctx context.Context, q ModelUsageQuery) (ModelUsageSummary, error) {
	var summary ModelUsageSummary
	if c == nil || c.db == nil {
		return summary, fmt.Errorf("clickhouse client is nil")
	}
	tableIdentifier, err := quoteIdentifier(c.ModelUsageTable())
	if err != nil {
		return summary, err
	}
	query := fmt.Sprintf(`SELECT
	coalesce(sum(input_tokens), 0) AS input_tokens,
	coalesce(sum(output_tokens), 0) AS output_tokens,
	coalesce(sum(cached_tokens), 0) AS cached_tokens,
	coalesce(sum(total_tokens), 0) AS total_tokens,
	coalesce(sum(request_count), 0) AS requests
FROM %s
WHERE team_id = ? AND event_time >= ? AND event_time < ?`, tableIdentifier)
	err = c.db.QueryRowContext(ctx, query, q.TeamID, q.Start, q.End).Scan(
		&summary.InputTokens,
		&summary.OutputTokens,
		&summary.CachedTokens,
		&summary.TotalTokens,
		&summary.Requests,
	)
	return summary, err
}

func (c *Client) QueryModelUsageTopUsers(ctx context.Context, q ModelUsageQuery, limit int) ([]ModelUsageTopUser, error) {
	if c == nil || c.db == nil {
		return nil, fmt.Errorf("clickhouse client is nil")
	}
	if limit <= 0 {
		limit = 5
	}
	tableIdentifier, err := quoteIdentifier(c.ModelUsageTable())
	if err != nil {
		return nil, err
	}
	query := fmt.Sprintf(`SELECT
	user_id,
	coalesce(sum(total_tokens), 0) AS total_tokens,
	coalesce(sum(request_count), 0) AS requests
FROM %s
WHERE team_id = ? AND event_time >= ? AND event_time < ?
GROUP BY user_id
ORDER BY total_tokens DESC
LIMIT ?`, tableIdentifier)
	rows, err := c.db.QueryContext(ctx, query, q.TeamID, q.Start, q.End, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []ModelUsageTopUser
	for rows.Next() {
		var user ModelUsageTopUser
		if err := rows.Scan(&user.UserID, &user.TotalTokens, &user.Requests); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return users, nil
}

func applyPoolOptions(db *sql.DB, cfg config.ClickHouse) {
	if cfg.MaxOpenConns > 0 {
		db.SetMaxOpenConns(cfg.MaxOpenConns)
	}
	if cfg.MaxIdleConns > 0 {
		db.SetMaxIdleConns(cfg.MaxIdleConns)
	}
	if lifetime := connMaxLifetime(cfg.ConnMaxLifetime); lifetime > 0 {
		db.SetConnMaxLifetime(lifetime)
	}
}

func connMaxLifetime(seconds int) time.Duration {
	if seconds <= 0 {
		return 0
	}
	return time.Duration(seconds) * time.Second
}

func buildDSN(cfg config.ClickHouse) (string, error) {
	username, password := readCredentials(cfg)
	return buildDSNWithCredentials(cfg, username, password)
}

func buildBootstrapDSN(cfg config.ClickHouse) (string, error) {
	cfg.Database = ""
	return buildDSNWithCredentials(cfg, cfg.Username, cfg.Password)
}

func readCredentials(cfg config.ClickHouse) (string, string) {
	username := strings.TrimSpace(cfg.ReadUsername)
	password := cfg.ReadPassword
	if username == "" {
		username = cfg.Username
		password = cfg.Password
	}
	return username, password
}

func buildDSNWithCredentials(cfg config.ClickHouse, username, password string) (string, error) {
	addr := strings.TrimSpace(cfg.Addr)
	if addr == "" {
		return "", fmt.Errorf("clickhouse addr is empty")
	}
	if !strings.Contains(addr, "://") {
		addr = "clickhouse://" + addr
	}
	u, err := url.Parse(addr)
	if err != nil {
		return "", err
	}
	if username != "" {
		u.User = url.UserPassword(username, password)
	}
	if cfg.Database != "" {
		u.Path = "/" + strings.TrimPrefix(cfg.Database, "/")
	}
	return u.String(), nil
}

func shouldInitSchema(cfg config.ClickHouse) bool {
	return cfg.InitEnabled
}

func initSchema(cfg config.ClickHouse) error {
	if !shouldInitSchema(cfg) {
		return nil
	}
	return ensureSchema(cfg)
}

func ensureSchema(cfg config.ClickHouse) error {
	database := strings.TrimSpace(cfg.Database)
	dsn, err := buildBootstrapDSN(cfg)
	if err != nil {
		return err
	}
	db, err := sql.Open("clickhouse", dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		return err
	}
	if database != "" {
		databaseIdentifier, err := quoteIdentifier(database)
		if err != nil {
			return err
		}
		if _, err := db.ExecContext(context.Background(), "CREATE DATABASE IF NOT EXISTS "+databaseIdentifier); err != nil {
			return err
		}
	}

	databaseDSN, err := buildDSNWithCredentials(cfg, cfg.Username, cfg.Password)
	if err != nil {
		return err
	}
	databaseDB, err := sql.Open("clickhouse", databaseDSN)
	if err != nil {
		return err
	}
	defer databaseDB.Close()
	if err := databaseDB.Ping(); err != nil {
		return err
	}
	query, err := buildTaskLogTableSQL(cfg.Table)
	if err != nil {
		return err
	}
	if _, err := databaseDB.ExecContext(context.Background(), query); err != nil {
		return err
	}
	query, err = buildModelUsageTableSQL(cfg.ModelUsageTable)
	if err != nil {
		return err
	}
	_, err = databaseDB.ExecContext(context.Background(), query)
	return err
}

func quoteIdentifier(identifier string) (string, error) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return "", fmt.Errorf("clickhouse identifier is empty")
	}
	return "`" + strings.ReplaceAll(identifier, "`", "``") + "`", nil
}

func buildTaskLogTableSQL(table string) (string, error) {
	table, err := NormalizeTable(table)
	if err != nil {
		return "", err
	}
	tableIdentifier, err := quoteIdentifier(table)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s
(
	task_id UUID,
	ts DateTime64(9, 'UTC'),
	event LowCardinality(String),
	kind LowCardinality(String),
	turn_seq UInt32,
	data String CODEC(ZSTD(3)),
	msg_seq_start UInt64,
	msg_seq_end UInt64,
	source LowCardinality(String),
	log_version UInt16,
	ingest_id UUID
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (task_id, turn_seq, ts, msg_seq_start, ingest_id)
TTL ts + INTERVAL 60 DAY`, tableIdentifier), nil
}

func buildModelUsageTableSQL(table string) (string, error) {
	table, err := NormalizeModelUsageTable(table)
	if err != nil {
		return "", err
	}
	tableIdentifier, err := quoteIdentifier(table)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %s
(
	event_time DateTime64(3, 'Asia/Shanghai'),
	team_id String,
	user_id String,
	task_id String,
	project_id String,
	provider String,
	model_id String,
	model_name String,
	input_tokens UInt64,
	output_tokens UInt64,
	cached_tokens UInt64,
	total_tokens UInt64,
	request_count UInt64 DEFAULT 1,
	success UInt8,
	duration_ms UInt64,
	trace_id String,
	request_id String,
	source String,
	created_at DateTime64(3, 'Asia/Shanghai') DEFAULT now64(3)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (team_id, event_time, user_id, task_id, model_id)
TTL toDateTime(event_time) + INTERVAL 400 DAY`, tableIdentifier), nil
}
