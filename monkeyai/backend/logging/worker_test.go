package logging

import (
	"context"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"
)

func TestWorkerRecoveryFlushesBeforeRecovery(t *testing.T) {
	r, out, _, _ := runtimeTest(t)
	worker := NewWorker(r.Logger(), "resourceimport", "cleanup_uploads", "object_storage")
	worker.Report(context.Background(), io.ErrUnexpectedEOF)
	worker.Report(context.Background(), io.ErrUnexpectedEOF)
	worker.Report(context.Background(), nil)
	worker.Report(context.Background(), nil)
	worker.Report(context.Background(), io.ErrUnexpectedEOF)
	rows := records(t, out)
	if len(rows) != 4 || rows[1]["event"] != "logging.error.summary" || rows[1]["occurrence_count"] != float64(2) || rows[2]["event"] != "dependency.recovered" || rows[2]["failure_count"] != float64(2) {
		t.Fatalf("恢复顺序或计数错误: %v", rows)
	}
}

type countWriter struct{ count atomic.Uint64 }

func (w *countWriter) Write(p []byte) (int, error) { w.count.Add(1); return len(p), nil }
func TestSchedulerFlushesWithoutNewEvents(t *testing.T) {
	var out countWriter
	r, err := NewRuntime(&out, slog.LevelError, Settings{true, time.Second, 128})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	repeatFailure(r.Logger(), 2)
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for out.count.Load() < 2 {
		select {
		case <-deadline.C:
			t.Fatal("无后续请求时未刷新摘要")
		case <-ticker.C:
		}
	}
}
func BenchmarkLoggerDistribution(b *testing.B) {
	for _, count := range []int{1, 4096, 5000} {
		b.Run(stringID(count), func(b *testing.B) {
			r, _ := NewRuntime(io.Discard, slog.LevelDebug, DefaultSettings())
			defer r.Close()
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				r.Logger().Error("故障", "event", "model.call.completed", "model_id", stringID(i%count), "operation", "proxy_request")
			}
		})
	}
}
func stringID(n int) string {
	const digits = "0123456789"
	var buf [20]byte
	i := len(buf)
	for {
		i--
		buf[i] = digits[n%10]
		n /= 10
		if n == 0 {
			return string(buf[i:])
		}
	}
}
func BenchmarkSlogBaseline(b *testing.B) {
	logger := slog.New(slog.NewJSONHandler(io.Discard, nil))
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		logger.Error("故障", "event", "model.call.completed", "model_id", "m1", "operation", "proxy_request")
	}
}
