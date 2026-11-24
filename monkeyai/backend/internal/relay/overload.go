package relay

import (
	"context"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

const overloadInterval = 5 * time.Second

type overloadWindow struct {
	rejected       map[string]int
	total, peak    int
	active, oldest slog.Value
}

// 调用方持有预算锁。仅在首次拒绝或占用创新高时采样，定时输出不持锁。
func (b *dataBudget) recordRejection(operation string) {
	if b.logger == nil {
		return
	}
	w := b.overload
	if w == nil {
		w = &overloadWindow{rejected: make(map[string]int)}
		b.overload = w
		time.AfterFunc(overloadInterval, func() {
			b.mu.Lock()
			b.overload = nil
			b.mu.Unlock()
			logging.Event(context.Background(), b.logger, slog.LevelWarn, "relay.data.overload", "数据通道满额统计",
				"window_ms", overloadInterval.Milliseconds(), "rejections", w.total, "rejected_by_operation", countGroup(w.rejected),
				"peak_active", w.peak, "active_by_operation", w.active, "oldest_ms_by_operation", w.oldest)
		})
	}
	w.rejected[operation]++
	w.total++
	if len(b.active) <= w.peak {
		return
	}
	w.peak = len(b.active)
	counts, oldest := make(map[string]int), make(map[string]int64)
	now := time.Now()
	for p := range b.active {
		counts[p.operation]++
		oldest[p.operation] = max(oldest[p.operation], now.Sub(p.started).Milliseconds())
	}
	w.active, w.oldest = countGroup(counts), countGroup(oldest)
}

func countGroup[T int | int64](values map[string]T) slog.Value {
	attrs := make([]slog.Attr, 0, len(values))
	for key, value := range values {
		attrs = append(attrs, slog.Int64(key, int64(value)))
	}
	return slog.GroupValue(attrs...)
}
