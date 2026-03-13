// Package store 提供数据库存储和迁移功能
package store

import (
	"context"
	"database/sql"
	"log/slog"

	"github.com/chaitin/MonkeyCode/backend/config"
)

// Client 数据库客户端
type Client struct {
	db *sql.DB
}

// NewClient 创建新的数据库客户端
func NewClient(cfg *config.Config, logger *slog.Logger) (*Client, error) {
	db, err := sql.Open("postgres", cfg.Database.Master)
	if err != nil {
		return nil, err
	}

	// 测试连接
	if err := db.Ping(); err != nil {
		return nil, err
	}

	logger.With("component", "db").Info("database connection established")

	return &Client{db: db}, nil
}

// QueryContext 执行查询
func (c *Client) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return c.db.QueryContext(ctx, query, args...)
}

// ExecContext 执行SQL语句
func (c *Client) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return c.db.ExecContext(ctx, query, args...)
}

// Close 关闭数据库连接
func (c *Client) Close() error {
	return c.db.Close()
}
