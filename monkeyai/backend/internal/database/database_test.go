package database

import (
	"testing"
	"time"
)

func TestPoolConfig(t *testing.T) {
	for _, key := range []string{"PGSERVICE", "PGSERVICEFILE", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGCONNECT_TIMEOUT"} {
		t.Setenv(key, "")
	}
	for _, tt := range []struct {
		name     string
		dsn      string
		max      int32
		min      int32
		idle     time.Duration
		lifetime time.Duration
		jitter   time.Duration
	}{
		{
			name: "默认配置", dsn: "postgres://localhost/test",
			max: 80, min: 2, idle: 5 * time.Minute, lifetime: 30 * time.Minute, jitter: 5 * time.Minute,
		},
		{
			name: "URL覆盖", dsn: "postgres://localhost/test?pool_max_conns=20&pool_min_conns=0&pool_max_conn_idle_time=1m&pool_max_conn_lifetime=1h&pool_max_conn_lifetime_jitter=0",
			max: 20, min: 0, idle: time.Minute, lifetime: time.Hour,
		},
		{
			name: "关键字覆盖", dsn: "host=localhost dbname=test pool_max_conns=40 pool_min_conns=4 pool_max_conn_idle_time=2m pool_max_conn_lifetime=2h pool_max_conn_lifetime_jitter=10m",
			max: 40, min: 4, idle: 2 * time.Minute, lifetime: 2 * time.Hour, jitter: 10 * time.Minute,
		},
		{
			name: "单连接覆盖", dsn: "postgres://localhost/test?pool_max_conns=1",
			max: 1, min: 1, idle: 5 * time.Minute, lifetime: 30 * time.Minute, jitter: 5 * time.Minute,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := parseConfig(tt.dsn)
			if err != nil {
				t.Fatal(err)
			}
			if cfg.MaxConns != tt.max || cfg.MinConns != tt.min ||
				cfg.MaxConnIdleTime != tt.idle || cfg.MaxConnLifetime != tt.lifetime ||
				cfg.MaxConnLifetimeJitter != tt.jitter {
				t.Fatalf("连接池配置不符: max=%d min=%d idle=%s lifetime=%s jitter=%s",
					cfg.MaxConns, cfg.MinConns, cfg.MaxConnIdleTime, cfg.MaxConnLifetime, cfg.MaxConnLifetimeJitter)
			}
			for key := range cfg.ConnConfig.RuntimeParams {
				if key == "pool_max_conns" || key == "pool_min_conns" ||
					key == "pool_max_conn_idle_time" || key == "pool_max_conn_lifetime" ||
					key == "pool_max_conn_lifetime_jitter" {
					t.Fatalf("连接池参数不能发送给数据库: %s", key)
				}
			}
		})
	}
}
