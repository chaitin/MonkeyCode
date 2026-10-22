package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"
)

func runtimeTest(t *testing.T) (*Runtime, *bytes.Buffer, *slog.LevelVar, func(time.Duration)) {
	t.Helper()
	var output bytes.Buffer
	level := new(slog.LevelVar)
	level.Set(slog.LevelDebug)
	r, err := NewRuntime(&output, level, Settings{true, time.Second, 128})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1700000000, 0)
	r.mu.Lock()
	r.now = func() time.Time { return now }
	r.mu.Unlock()
	t.Cleanup(func() { _ = r.Close() })
	return r, &output, level, func(d time.Duration) { r.mu.Lock(); now = now.Add(d); r.mu.Unlock() }
}
func records(t *testing.T, output *bytes.Buffer) []map[string]any {
	t.Helper()
	var result []map[string]any
	decoder := json.NewDecoder(bytes.NewReader(output.Bytes()))
	for {
		var row map[string]any
		err := decoder.Decode(&row)
		if err == io.EOF {
			return result
		}
		if err != nil {
			t.Fatal(err)
		}
		result = append(result, row)
	}
}
func repeatFailure(logger *slog.Logger, count int) {
	for i := 0; i < count; i++ {
		logger.Error("故障", "event", "model.call.completed", "operation", "proxy_request", "model_id", "m1", "request_id", fmt.Sprintf("r%d", i), "error_code", "connection_refused")
	}
}
func TestDedupFixedWindowsAndIdle(t *testing.T) {
	r, out, _, advance := runtimeTest(t)
	derived := r.Logger().With("module", "proxy")
	repeatFailure(derived, 1000)
	advance(time.Second)
	r.Flush()
	rows := records(t, out)
	if len(rows) != 2 || rows[1]["occurrence_count"] != float64(1000) || rows[1]["detail_count"] != float64(1) || rows[1]["suppressed_count"] != float64(999) {
		t.Fatalf("首窗口计数错误: %v", rows)
	}
	if _, ok := rows[1]["request_id"]; ok {
		t.Fatal("摘要含单一请求 ID")
	}
	repeatFailure(derived.WithGroup("gateway"), 600)
	advance(time.Second)
	r.Flush()
	rows = records(t, out)
	if len(rows) != 3 || rows[2]["occurrence_count"] != float64(600) || rows[2]["detail_count"] != float64(0) {
		t.Fatalf("持续窗口计数错误: %v", rows)
	}
	advance(time.Second)
	r.Flush()
	repeatFailure(derived, 1)
	if len(records(t, out)) != 4 {
		t.Fatal("空闲后未直出首条")
	}
}
func TestDedupFilteringCloseAndLateEvents(t *testing.T) {
	r, out, level, advance := runtimeTest(t)
	repeatFailure(r.Logger(), 10)
	level.Set(slog.Level(12))
	advance(time.Second)
	r.Flush()
	level.Set(slog.LevelDebug)
	r.Flush()
	if len(records(t, out)) != 1 {
		t.Fatal("重新调级补发了过期摘要")
	}
	repeatFailure(r.Logger(), 10)
	_ = r.Close()
	_ = r.Close()
	rows := records(t, out)
	if len(rows) != 2 || rows[1]["occurrence_count"] != float64(10) {
		t.Fatalf("关闭刷新错误: %v", rows)
	}
	repeatFailure(r.Logger(), 2)
	if len(records(t, out)) != 4 || r.Snapshot().ActiveKeys != 0 {
		t.Fatal("迟到事件未直出")
	}
}
func TestDedupCapacityAndUnknownEvents(t *testing.T) {
	r, _, _, _ := runtimeTest(t)
	for i := 0; i < 140; i++ {
		r.Logger().Error("故障", "event", "model.call.completed", "operation", "proxy_request", "model_id", fmt.Sprint(i))
	}
	if s := r.Snapshot(); s.ActiveKeys != 128 || s.Overflow != 12 {
		t.Fatalf("容量错误: %+v", s)
	}
	r.Logger().Error("最终失败", "event", "billing.settlement.failed")
	r.Logger().Error("最终失败", "event", "billing.settlement.failed")
	if r.Snapshot().Suppressed != 0 {
		t.Fatal("未登记事件被压制")
	}
}
func TestDedupConcurrentAndRecovery(t *testing.T) {
	r, out, _, _ := runtimeTest(t)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Go(func() { repeatFailure(r.Logger(), 50) })
	}
	wg.Wait()
	r.Recovered(context.Background(), "model.call.completed", slog.String("operation", "proxy_request"), slog.String("model_id", "m1"))
	repeatFailure(r.Logger(), 1)
	_ = r.Close()
	rows := records(t, out)
	if len(rows) != 3 || rows[1]["occurrence_count"] != float64(1000) {
		t.Fatalf("恢复或并发计数错误: %v", rows)
	}
}

type failedOutput struct{}

func (failedOutput) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }
func TestOutputErrorStatistics(t *testing.T) {
	r, err := NewRuntime(failedOutput{}, slog.LevelDebug, DefaultSettings())
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	r.Logger().Error("测试")
	if r.Snapshot().OutputErrors != 1 {
		t.Fatal("未统计输出故障")
	}
}
func BenchmarkDedup(b *testing.B) {
	for _, enabled := range []bool{false, true} {
		b.Run(fmt.Sprint(enabled), func(b *testing.B) {
			settings := DefaultSettings()
			settings.Enabled = enabled
			r, _ := NewRuntime(io.Discard, slog.LevelDebug, settings)
			defer r.Close()
			b.ReportAllocs()
			b.ResetTimer()
			b.RunParallel(func(pb *testing.PB) {
				for pb.Next() {
					repeatFailure(r.Logger(), 1)
				}
			})
		})
	}
}
