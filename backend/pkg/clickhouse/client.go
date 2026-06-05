package clickhouse

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	_ "github.com/ClickHouse/clickhouse-go/v2"
	"github.com/golang-migrate/migrate/v4"
	migrateclickhouse "github.com/golang-migrate/migrate/v4/database/clickhouse"
	"github.com/golang-migrate/migrate/v4/source"
	"github.com/golang-migrate/migrate/v4/source/iofs"

	"github.com/chaitin/MonkeyCode/backend/config"
)

const (
	TaskLogTable    = "task_logs"
	ModelUsageTable = "model_usage_events"

	clickHouseMigrationRoot        = "migration"
	clickHouseSingleMigrationPath  = "clickhouse_single"
	clickHouseClusterMigrationPath = "clickhouse_cluster"
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

type TeamConversationQuery struct {
	TaskIDs    []string
	Start7d    time.Time
	TodayStart time.Time
	TrendStart time.Time
	End        time.Time
}

type TeamConversationStats struct {
	Total        int64
	Count7d      int64
	CountToday   int64
	DailyCreated []TeamConversationDailyCount
}

type TeamConversationDailyCount struct {
	Date  string
	Count int64
}

type TeamConversationListQuery struct {
	TaskIDs []string
	Cursor  string
	Limit   int
}

type TeamConversationRow struct {
	TaskID    string
	TS        time.Time
	Event     string
	Kind      string
	TurnSeq   uint32
	Data      string
	MsgSeqStart uint64
	MsgSeqEnd   uint64
}

type TeamConversationListResult struct {
	Rows        []TeamConversationRow
	NextCursor  string
	HasNextPage bool
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

func (c *Client) QueryTeamConversationStats(ctx context.Context, q TeamConversationQuery) (TeamConversationStats, error) {
	var stats TeamConversationStats
	if c == nil || c.db == nil {
		return stats, fmt.Errorf("clickhouse client is nil")
	}
	if len(q.TaskIDs) == 0 {
		return stats, nil
	}
	tableIdentifier, err := quoteIdentifier(c.Table())
	if err != nil {
		return stats, err
	}
	inClause, args := buildInClause(q.TaskIDs)
	query := fmt.Sprintf(`SELECT
	coalesce(count(), 0) AS total,
	coalesce(countIf(ts >= ? AND ts < ?), 0) AS count_7d,
	coalesce(countIf(ts >= ? AND ts < ?), 0) AS count_today
FROM %s
WHERE task_id IN (%s) AND event = 'user-input'`, tableIdentifier, inClause)
	countArgs := append([]any{q.Start7d, q.End, q.TodayStart, q.End}, args...)
	if err := c.db.QueryRowContext(ctx, query, countArgs...).Scan(&stats.Total, &stats.Count7d, &stats.CountToday); err != nil {
		return stats, err
	}

	dailyQuery := fmt.Sprintf(`SELECT toString(toDate(ts)) AS date, count() AS count
FROM %s
WHERE task_id IN (%s) AND event = 'user-input' AND ts >= ? AND ts < ?
GROUP BY date
ORDER BY date ASC`, tableIdentifier, inClause)
	dailyArgs := append([]any{}, args...)
	dailyArgs = append(dailyArgs, q.TrendStart, q.End)
	rows, err := c.db.QueryContext(ctx, dailyQuery, dailyArgs...)
	if err != nil {
		return stats, err
	}
	defer rows.Close()
	for rows.Next() {
		var item TeamConversationDailyCount
		if err := rows.Scan(&item.Date, &item.Count); err != nil {
			return stats, err
		}
		stats.DailyCreated = append(stats.DailyCreated, item)
	}
	if err := rows.Err(); err != nil {
		return stats, err
	}
	return stats, nil
}

func (c *Client) QueryTeamConversations(ctx context.Context, q TeamConversationListQuery) (*TeamConversationListResult, error) {
	if c == nil || c.db == nil {
		return nil, fmt.Errorf("clickhouse client is nil")
	}
	if len(q.TaskIDs) == 0 {
		return &TeamConversationListResult{}, nil
	}
	if q.Limit <= 0 {
		q.Limit = 20
	}
	if q.Limit > 100 {
		q.Limit = 100
	}
	tableIdentifier, err := quoteIdentifier(c.Table())
	if err != nil {
		return nil, err
	}
	inClause, args := buildInClause(q.TaskIDs)
	cursorFilter := ""
	if q.Cursor != "" {
		cursorAt, err := time.Parse(time.RFC3339Nano, q.Cursor)
		if err != nil {
			return nil, err
		}
		cursorFilter = "AND ts < ?"
		args = append(args, cursorAt)
	}
	args = append(args, q.Limit+1)
	query := fmt.Sprintf(`SELECT task_id, ts, event, kind, turn_seq, data, msg_seq_start, msg_seq_end
FROM %s
WHERE task_id IN (%s) AND event = 'user-input' %s
ORDER BY ts DESC, task_id DESC, turn_seq DESC, msg_seq_start DESC
LIMIT ?`, tableIdentifier, inClause, cursorFilter)
	rows, err := c.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := &TeamConversationListResult{}
	for rows.Next() {
		var row TeamConversationRow
		if err := rows.Scan(&row.TaskID, &row.TS, &row.Event, &row.Kind, &row.TurnSeq, &row.Data, &row.MsgSeqStart, &row.MsgSeqEnd); err != nil {
			return nil, err
		}
		result.Rows = append(result.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(result.Rows) > q.Limit {
		result.HasNextPage = true
		result.Rows = result.Rows[:q.Limit]
	}
	if len(result.Rows) > 0 {
		result.NextCursor = result.Rows[len(result.Rows)-1].TS.UTC().Format(time.RFC3339Nano)
	}
	return result, nil
}

func buildInClause(values []string) (string, []any) {
	placeholders := make([]string, 0, len(values))
	args := make([]any, 0, len(values))
	for _, value := range values {
		placeholders = append(placeholders, "?")
		args = append(args, value)
	}
	return strings.Join(placeholders, ","), args
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
	return migrateSingleSchema(databaseDB, cfg)
}

func quoteIdentifier(identifier string) (string, error) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return "", fmt.Errorf("clickhouse identifier is empty")
	}
	return "`" + strings.ReplaceAll(identifier, "`", "``") + "`", nil
}

func migrateSingleSchema(db *sql.DB, cfg config.ClickHouse) error {
	source, err := newSingleMigrationSource(cfg.Table, cfg.ModelUsageTable)
	if err != nil {
		return err
	}
	driver, err := migrateclickhouse.WithInstance(db, &migrateclickhouse.Config{
		DatabaseName:          cfg.Database,
		MigrationsTable:       "schema_migrations",
		MigrationsTableEngine: "MergeTree",
	})
	if err != nil {
		_ = source.Close()
		return err
	}
	m, err := migrate.NewWithInstance("clickhouse_single", source, "clickhouse", driver)
	if err != nil {
		_ = source.Close()
		_ = driver.Close()
		return err
	}
	defer func() {
		sourceErr, databaseErr := m.Close()
		_ = sourceErr
		_ = databaseErr
	}()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}
	return nil
}

func newSingleMigrationSource(taskLogTable, modelUsageTable string) (source.Driver, error) {
	return newClickHouseMigrationSource(clickHouseSingleMigrationPath, taskLogTable, modelUsageTable)
}

func newClusterMigrationSource(taskLogTable, modelUsageTable string) (source.Driver, error) {
	return newClickHouseMigrationSource(clickHouseClusterMigrationPath, taskLogTable, modelUsageTable)
}

func newClickHouseMigrationSource(path, taskLogTable, modelUsageTable string) (source.Driver, error) {
	table, err := NormalizeTable(taskLogTable)
	if err != nil {
		return nil, err
	}
	modelUsageTable, err = NormalizeModelUsageTable(modelUsageTable)
	if err != nil {
		return nil, err
	}
	root, err := findClickHouseMigrationRoot()
	if err != nil {
		return nil, err
	}
	base, err := iofs.New(os.DirFS(root), path)
	if err != nil {
		return nil, err
	}
	taskLogIdentifier, err := quoteIdentifier(table)
	if err != nil {
		_ = base.Close()
		return nil, err
	}
	modelUsageIdentifier, err := quoteIdentifier(modelUsageTable)
	if err != nil {
		_ = base.Close()
		return nil, err
	}
	return &templateSource{
		base: base,
		replacements: map[string]string{
			"{{TASK_LOG_TABLE}}":        taskLogIdentifier,
			"{{TASK_LOG_TABLE_RAW}}":    table,
			"{{MODEL_USAGE_TABLE}}":     modelUsageIdentifier,
			"{{MODEL_USAGE_TABLE_RAW}}": modelUsageTable,
		},
	}, nil
}

func findClickHouseMigrationRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		candidate := filepath.Join(wd, clickHouseMigrationRoot)
		info, err := os.Stat(candidate)
		if err == nil && info.IsDir() {
			return candidate, nil
		}
		parent := filepath.Dir(wd)
		if parent == wd {
			return "", fmt.Errorf("clickhouse migration root %q not found", clickHouseMigrationRoot)
		}
		wd = parent
	}
}

type templateSource struct {
	base         source.Driver
	replacements map[string]string
}

func (s *templateSource) Open(url string) (source.Driver, error) {
	return nil, fmt.Errorf("template source does not support Open")
}

func (s *templateSource) Close() error {
	return s.base.Close()
}

func (s *templateSource) First() (uint, error) {
	return s.base.First()
}

func (s *templateSource) Prev(version uint) (uint, error) {
	return s.base.Prev(version)
}

func (s *templateSource) Next(version uint) (uint, error) {
	return s.base.Next(version)
}

func (s *templateSource) ReadUp(version uint) (io.ReadCloser, string, error) {
	body, identifier, err := s.base.ReadUp(version)
	if err != nil {
		return nil, "", err
	}
	rendered, err := s.render(body)
	if err != nil {
		return nil, "", err
	}
	return rendered, identifier, nil
}

func (s *templateSource) ReadDown(version uint) (io.ReadCloser, string, error) {
	body, identifier, err := s.base.ReadDown(version)
	if err != nil {
		return nil, "", err
	}
	rendered, err := s.render(body)
	if err != nil {
		return nil, "", err
	}
	return rendered, identifier, nil
}

func (s *templateSource) render(body io.ReadCloser) (io.ReadCloser, error) {
	defer body.Close()
	data, err := io.ReadAll(body)
	if err != nil {
		return nil, err
	}
	query := string(data)
	for placeholder, value := range s.replacements {
		query = strings.ReplaceAll(query, placeholder, value)
	}
	return io.NopCloser(bytes.NewBufferString(query)), nil
}
