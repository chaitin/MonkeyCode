package mcp

import (
	"context"
	"errors"
	"hash/fnv"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type refreshConfig struct {
	interval, scan, startInterval, upstreamStartInterval, timeout time.Duration
	concurrent, upstreamConcurrent                                int
}

func toolsRefreshConfig() refreshConfig {
	duration := func(key string, fallback time.Duration) time.Duration {
		if raw := os.Getenv("MONKEYAI_MCP_TOOLS_REFRESH_" + key); raw != "" {
			if d, err := time.ParseDuration(raw); err == nil && d >= time.Millisecond {
				return d
			}
			slog.Warn("MCP 工具刷新配置无效，使用默认值", "setting", key, "default", fallback)
		}
		return fallback
	}
	count := func(key string, fallback int) int {
		if raw := os.Getenv("MONKEYAI_MCP_TOOLS_REFRESH_" + key); raw != "" {
			if n, err := strconv.Atoi(raw); err == nil && n > 0 {
				return n
			}
			slog.Warn("MCP 工具刷新配置无效，使用默认值", "setting", key, "default", fallback)
		}
		return fallback
	}
	return refreshConfig{
		interval: duration("INTERVAL", 10*time.Minute), scan: duration("SCAN_INTERVAL", 10*time.Second),
		startInterval:         duration("GLOBAL_MIN_START_INTERVAL", 500*time.Millisecond),
		upstreamStartInterval: duration("PER_UPSTREAM_MIN_START_INTERVAL", time.Second), timeout: duration("TIMEOUT", 30*time.Second),
		concurrent: count("MAX_CONCURRENT", 10), upstreamConcurrent: count("PER_UPSTREAM_MAX_CONCURRENT", 1),
	}
}

type refreshTarget struct {
	connector, credential, upstream string
	due, attempted                  time.Time
	running                         bool
}

type refreshUpstream struct {
	running int
	next    time.Time
}

func nextToolRefresh(key string, after time.Time, interval time.Duration) time.Time {
	h := fnv.New64a()
	_, _ = h.Write([]byte(key))
	offset := time.Duration(h.Sum64() % uint64(interval))
	next := after.Truncate(interval).Add(offset)
	if !next.After(after) {
		next = next.Add(interval)
	}
	return next
}

func toolUpstream(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}
	port := u.Port()
	if port == "" {
		port = "80"
		if u.Scheme == "https" {
			port = "443"
		}
	}
	return net.JoinHostPort(strings.TrimSuffix(strings.ToLower(u.Hostname()), "."), port)
}

func pickToolRefresh(now time.Time, targets map[string]*refreshTarget, upstreams map[string]refreshUpstream, limit int) *refreshTarget {
	var next *refreshTarget
	for _, target := range targets {
		state := upstreams[target.upstream]
		if target.running || now.Before(target.due) || state.running >= limit || now.Before(state.next) {
			continue
		}
		if next == nil || target.due.Before(next.due) {
			next = target
		}
	}
	return next
}

func (s *Service) runToolRefresh(ctx context.Context) {
	cfg := toolsRefreshConfig()
	for ctx.Err() == nil {
		if err := s.leadToolRefresh(ctx, cfg); err != nil && ctx.Err() == nil {
			logging.Event(ctx, slog.Default(), slog.LevelWarn, "mcp.tools.refresh.worker_failed", "MCP 工具刷新调度失败", "error", err)
		}
		timer := time.NewTimer(cfg.scan)
		select {
		case <-ctx.Done():
		case <-timer.C:
		}
		timer.Stop()
	}
}

func (s *Service) leadToolRefresh(ctx context.Context, cfg refreshConfig) error {
	claim, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	lease, err := s.Store.Pool.Acquire(claim)
	if err != nil {
		return err
	}
	leader, err := sqlc.New(lease).TryToolRefreshLock(claim)
	if err != nil || leader {
		defer func() {
			closeCtx, closeCancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer closeCancel()
			_ = lease.Hijack().Close(closeCtx)
		}()
	} else {
		lease.Release()
	}
	if err != nil || !leader {
		return err
	}
	return s.refreshToolLoop(ctx, lease, cfg)
}

func (s *Service) refreshToolLoop(parent context.Context, lease *pgxpool.Conn, cfg refreshConfig) error {
	ctx, cancel := context.WithCancel(parent)
	var running int
	done := make(chan *refreshTarget, cfg.concurrent)
	defer func() {
		cancel()
		for range running {
			<-done
		}
	}()
	started := time.Now()
	nextStart := started.Add(max(cfg.startInterval, cfg.upstreamStartInterval))
	lastBacklogLog := started
	targets := map[string]*refreshTarget{}
	upstreams := map[string]refreshUpstream{}
	scan := func() error {
		query, stop := context.WithTimeout(ctx, 5*time.Second)
		defer stop()
		rows, err := sqlc.New(lease).ListToolRefreshTargets(query)
		if err != nil {
			return err
		}
		now := time.Now()
		for name, state := range upstreams {
			if state.running == 0 && !now.Before(state.next) {
				delete(upstreams, name)
			}
		}
		present := make(map[string]*refreshTarget, len(rows))
		for _, row := range rows {
			upstream := toolUpstream(row.Url)
			if upstream == "" {
				continue
			}
			key := row.ConnectorID + "/" + row.CredentialID
			target := targets[key]
			if target == nil {
				target = &refreshTarget{connector: row.ConnectorID, credential: row.CredentialID}
			}
			if !target.running {
				target.upstream = upstream
				after := started
				if target.attempted.After(after) {
					after = target.attempted
				}
				if row.ToolsSyncedAt != nil && row.ToolsSyncedAt.After(after) {
					after = *row.ToolsSyncedAt
				}
				target.due = nextToolRefresh(key, after, cfg.interval)
				if now.Sub(target.due) > cfg.interval && now.Sub(lastBacklogLog) >= cfg.interval {
					slog.WarnContext(ctx, "MCP 工具刷新出现积压", "wait", now.Sub(target.due), "connector_id", target.connector)
					lastBacklogLog = now
				}
			}
			present[key] = target
		}
		for key, target := range targets {
			if target.running && present[key] == nil {
				present[key] = target
			}
		}
		targets = present
		return nil
	}
	if err := scan(); err != nil {
		return err
	}
	scans, starts := time.NewTicker(cfg.scan), time.NewTicker(min(cfg.startInterval, cfg.upstreamStartInterval))
	defer scans.Stop()
	defer starts.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-scans.C:
			if err := scan(); err != nil {
				return err
			}
		case target := <-done:
			running--
			state := upstreams[target.upstream]
			state.running--
			upstreams[target.upstream] = state
			target.running = false
		case <-starts.C:
			now := time.Now()
			if ctx.Err() != nil || running >= cfg.concurrent || now.Before(nextStart) {
				continue
			}
			target := pickToolRefresh(now, targets, upstreams, cfg.upstreamConcurrent)
			if target == nil {
				continue
			}
			job := *target
			target.running, target.attempted = true, now
			target.due = nextToolRefresh(target.connector+"/"+target.credential, now, cfg.interval)
			state := upstreams[target.upstream]
			state.running++
			state.next = now.Add(cfg.upstreamStartInterval)
			upstreams[target.upstream] = state
			running++
			nextStart = now.Add(cfg.startInterval)
			go func() {
				defer func() { done <- target }()
				attempt, stop := context.WithTimeout(ctx, cfg.timeout)
				defer stop()
				if err := s.refreshToolTarget(attempt, job); err != nil && ctx.Err() == nil && !errors.Is(err, pgx.ErrNoRows) && !errors.Is(err, authorizationRequired) {
					logging.Event(ctx, slog.Default(), slog.LevelWarn, "mcp.tools.refresh.failed", "后台刷新 MCP 工具失败",
						"connector_id", target.connector, "credential_id", target.credential, "error", err)
				}
			}()
		}
	}
}

func (s *Service) refreshToolTarget(ctx context.Context, target refreshTarget) error {
	q := sqlc.New(s.Store.Pool)
	c, err := resource.DecodeObject(q.GetConnector(ctx, target.connector))
	if err != nil || !c.Bool("enabled") || toolUpstream(c.String("url")) != target.upstream {
		return err
	}
	var cred resource.Object
	if target.credential != "" {
		cred, err = resource.DecodeObject(q.GetCredential(ctx, sqlc.GetCredentialParams{ID: target.credential, ConnectorID: target.connector}))
		if err != nil {
			return err
		}
		if credentialStatus(c, cred) != "authorized" {
			return nil
		}
	} else if c.String("authorization_mode") != "none" {
		return nil
	}
	if syncedAt(c, cred).After(target.due) {
		return nil
	}
	started := snapshotTime()
	tools, err := s.discoverTools(ctx, c, cred)
	if err != nil && !snapshotDenied(err) {
		return err
	}
	if storeErr := s.storeTools(ctx, c, cred, started, tools, err != nil); storeErr != nil {
		return storeErr
	}
	return err
}
