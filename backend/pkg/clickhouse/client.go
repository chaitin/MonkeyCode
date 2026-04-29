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

const TaskLogTable = "task_logs"

var clickHouseIdentifierRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type Client struct {
	db    *sql.DB
	table string
}

func New(cfg config.ClickHouse, logger *slog.Logger) (*Client, error) {
	if strings.TrimSpace(cfg.Addr) == "" {
		return nil, nil
	}
	table, err := NormalizeTable(cfg.Table)
	if err != nil {
		return nil, err
	}

	dsn, err := buildDSN(cfg)
	if err != nil {
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
	return NewWithDBAndTable(db, table), nil
}

func NewWithDB(db *sql.DB) *Client {
	return &Client{db: db, table: TaskLogTable}
}

func NewWithDBAndTable(db *sql.DB, table string) *Client {
	table, err := NormalizeTable(table)
	if err != nil {
		table = TaskLogTable
	}
	return &Client{db: db, table: table}
}

func (c *Client) Table() string {
	if c == nil || c.table == "" {
		return TaskLogTable
	}
	return c.table
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

func (c *Client) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return c.db.QueryContext(ctx, query, args...)
}

func (c *Client) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return c.db.QueryRowContext(ctx, query, args...)
}

func (c *Client) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return c.db.ExecContext(ctx, query, args...)
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
