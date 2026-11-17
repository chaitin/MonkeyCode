package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := parseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("解析数据库连接地址: %w", err)
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("创建数据库连接池: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("连接数据库: %w", err)
	}

	return pool, nil
}

func parseConfig(url string) (*pgxpool.Config, error) {
	conn, err := pgx.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}

	// 仅补充未显式配置的池参数，保留连接串和 service 配置的覆盖能力。
	if _, ok := conn.RuntimeParams["pool_max_conns"]; !ok {
		cfg.MaxConns = 80
	}
	if _, ok := conn.RuntimeParams["pool_min_conns"]; !ok {
		cfg.MinConns = min(2, cfg.MaxConns)
	}
	if _, ok := conn.RuntimeParams["pool_max_conn_idle_time"]; !ok {
		cfg.MaxConnIdleTime = 5 * time.Minute
	}
	if _, ok := conn.RuntimeParams["pool_max_conn_lifetime"]; !ok {
		cfg.MaxConnLifetime = 30 * time.Minute
	}
	if _, ok := conn.RuntimeParams["pool_max_conn_lifetime_jitter"]; !ok {
		cfg.MaxConnLifetimeJitter = 5 * time.Minute
	}
	return cfg, nil
}
