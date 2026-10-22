package logging

import (
	"io"
	"log/slog"
	"runtime"
	"sync"
	"testing"
)

func TestConcurrentCloseAccountsForEveryEvent(t *testing.T) {
	r, out, _, _ := runtimeTest(t)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Go(func() { repeatFailure(r.Logger(), 100) })
	}
	wg.Go(func() { _ = r.Close() })
	wg.Go(func() { _ = r.Close() })
	wg.Wait()
	_ = r.Close()
	var occurrences float64
	for _, row := range records(t, out) {
		if row["event"] == "logging.error.summary" {
			occurrences += row["suppressed_count"].(float64)
		} else {
			occurrences++
		}
	}
	stats := r.Snapshot()
	if occurrences != 800 || stats.Candidates != 800 || stats.Details+stats.Suppressed != 800 || stats.ActiveKeys != 0 {
		t.Fatalf("并发关闭漏计: %.0f %+v", occurrences, stats)
	}
}
func TestRuntimeChurnKeepsSchedulersAndStateBounded(t *testing.T) {
	before := runtime.NumGoroutine()
	for pass := 0; pass < 8; pass++ {
		r, err := NewRuntime(io.Discard, slog.LevelDebug, Settings{true, DefaultSettings().Window, 128})
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 1000; i++ {
			r.Logger().Error("故障", "event", "model.call.completed", "operation", "proxy_request", "model_id", stringID(i))
		}
		if r.Snapshot().ActiveKeys != 128 {
			t.Fatal("指纹容量失控")
		}
		if runtime.NumGoroutine() > before+3 {
			t.Fatal("为每个指纹创建了调度器")
		}
		_ = r.Close()
		if r.Snapshot().ActiveKeys != 0 {
			t.Fatal("关闭后仍保留聚合状态")
		}
	}
	if runtime.NumGoroutine() > before+2 {
		t.Fatal("日志调度器未退出")
	}
}
