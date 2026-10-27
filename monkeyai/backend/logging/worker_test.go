package logging

import (
	"context"
	"io"
	"log/slog"
	"testing"
)

func TestWorkerReportsEveryFailureAndRecovery(t *testing.T) {
	logger, out := testLogger()
	worker := NewWorker(logger, "resourceimport", "cleanup_uploads", "object_storage")
	worker.Report(context.Background(), io.ErrUnexpectedEOF)
	worker.Report(context.Background(), io.ErrUnexpectedEOF)
	worker.Report(context.Background(), nil)
	worker.Report(context.Background(), nil)
	worker.Report(context.Background(), io.ErrUnexpectedEOF)
	rows := records(t, out)
	if len(rows) != 4 || rows[1]["event"] != "worker.scan.failed" || rows[1]["error_message"] != io.ErrUnexpectedEOF.Error() || rows[2]["event"] != "dependency.recovered" || rows[2]["failure_count"] != float64(2) {
		t.Fatalf("恢复顺序或计数错误: %v", rows)
	}
}

func BenchmarkLoggerDistribution(b *testing.B) {
	for _, count := range []int{1, 4096, 5000} {
		b.Run(stringID(count), func(b *testing.B) {
			logger := New(io.Discard, slog.LevelDebug)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				logger.Error("故障", "event", "model.call.completed", "model_id", stringID(i%count), "operation", "proxy_request")
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
