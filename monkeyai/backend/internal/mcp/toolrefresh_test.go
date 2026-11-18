package mcp

import (
	"context"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp/sqlc"
)

func TestToolRefreshLeader(t *testing.T) {
	f := setup(t)
	lease, err := f.pool.Acquire(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = lease.Hijack().Close(context.Background()) }()
	if held, err := sqlc.New(lease).TryToolRefreshLock(t.Context()); err != nil || !held {
		t.Fatalf("获取刷新调度锁失败: %v, %v", held, err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	if err := f.service.leadToolRefresh(ctx, toolsRefreshConfig()); err != nil || ctx.Err() != nil {
		t.Fatalf("持锁期间其他实例应直接放弃调度: %v, %v", err, ctx.Err())
	}
}

func TestToolRefreshSlots(t *testing.T) {
	interval := 10 * time.Minute
	now := time.Date(2026, 11, 18, 0, 0, 0, 0, time.UTC)
	first := nextToolRefresh("connector/credential-a", now, interval)
	second := nextToolRefresh("connector/credential-b", now, interval)
	if !first.After(now) || first.Sub(now) > interval || first.Equal(second) {
		t.Fatalf("同一连接下的凭证应分散刷新: %v, %v", first, second)
	}
	if onRestart := nextToolRefresh("connector/credential-a", now.Add(interval), interval); !onRestart.Equal(first.Add(interval)) {
		t.Fatalf("刷新时隙应在重启后保持稳定: %v", onRestart)
	}
	if next := nextToolRefresh("connector/credential-a", first.Add(3*interval), interval); !next.Equal(first.Add(4 * interval)) {
		t.Fatalf("积压后不应补跑错过的时隙: %v", next)
	}
}

func TestToolRefreshSkipsBusyUpstream(t *testing.T) {
	now := time.Now()
	busy := toolUpstream("https://EXAMPLE.test./mcp/v1")
	if busy != toolUpstream("https://example.test:443/mcp/v2") || busy == toolUpstream("http://example.test/mcp") {
		t.Fatal("上游应按归一化的地址和端口分组")
	}
	oldest := &refreshTarget{upstream: busy, due: now.Add(-time.Minute)}
	other := &refreshTarget{upstream: "other.test:443", due: now.Add(-time.Second)}
	targets := map[string]*refreshTarget{"oldest": oldest, "other": other}
	for _, limited := range []refreshUpstream{{running: 1}, {next: now.Add(time.Second)}} {
		if got := pickToolRefresh(now, targets, map[string]refreshUpstream{busy: limited}, 1); got != other {
			t.Fatalf("限速上游不应阻塞其他上游: %v", got)
		}
	}
	if got := pickToolRefresh(now, targets, nil, 1); got != oldest {
		t.Fatalf("应优先刷新积压最久的目标: %v", got)
	}
}
