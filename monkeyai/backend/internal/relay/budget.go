package relay

import (
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
)

const candidateTTL = 5 * time.Second

type relayMetrics struct {
	regular, terminal, candidates                                   atomic.Int64
	limited, expired, promoted, openFailed, revoked, received, sent atomic.Int64
}

// 每次数据通道附着分配独立预算，旧流的回调只操作其原预算。
type dataBudget struct {
	mu                          sync.Mutex
	regularCount, terminalCount int
	candidate                   *dataPermit
	opens                       chan struct{}
	metrics                     *relayMetrics
}

type dataPermit struct {
	budget                       *dataBudget
	terminal, candidate, expired bool
	refs                         int
	once                         sync.Once
	timer                        *time.Timer
}

func newDataBudget(metrics *relayMetrics) *dataBudget {
	return &dataBudget{opens: make(chan struct{}, 16), metrics: metrics}
}

func (b *dataBudget) reserve(terminal, candidate bool, close func()) *dataPermit {
	b.mu.Lock()
	defer b.mu.Unlock()
	room := b.regularCount < 15 && (!terminal || b.terminalCount < 8)
	if candidate && (!terminal || b.candidate != nil) || !candidate && !room {
		b.metrics.limited.Add(1)
		return nil
	}
	p := &dataPermit{budget: b, terminal: terminal, refs: 1}
	if room {
		b.regularCount++
		b.metrics.regular.Add(1)
		if terminal {
			b.terminalCount++
			b.metrics.terminal.Add(1)
		}
		if candidate {
			b.metrics.promoted.Add(1)
		}
	} else {
		p.candidate = true
		b.candidate = p
		b.metrics.candidates.Add(1)
		p.timer = time.AfterFunc(candidateTTL, func() {
			b.mu.Lock()
			if b.candidate != p || p.refs == 0 {
				b.mu.Unlock()
				return
			}
			p.expired = true
			b.metrics.expired.Add(1)
			b.mu.Unlock()
			close()
		})
	}
	return p
}

func (p *dataPermit) retain() func() {
	p.budget.mu.Lock()
	if p.refs == 0 || p.expired {
		p.budget.mu.Unlock()
		return nil
	}
	p.refs++
	p.budget.mu.Unlock()
	var once sync.Once
	return func() { once.Do(p.drop) }
}

func (p *dataPermit) release() { p.once.Do(p.drop) }

// 开流取消时保留 worker 引用，直到迟到流已关闭。
func (p *dataPermit) drop() {
	b := p.budget
	b.mu.Lock()
	defer b.mu.Unlock()
	p.refs--
	if p.refs != 0 {
		return
	}
	if p.candidate {
		b.candidate = nil
		b.metrics.candidates.Add(-1)
		p.timer.Stop()
	} else {
		b.regularCount--
		b.metrics.regular.Add(-1)
		if p.terminal {
			b.terminalCount--
			b.metrics.terminal.Add(-1)
		}
	}
	if next := b.candidate; next != nil && !next.expired && b.regularCount < 15 && b.terminalCount < 8 {
		b.candidate = nil
		next.candidate = false
		next.timer.Stop()
		b.regularCount++
		b.terminalCount++
		b.metrics.candidates.Add(-1)
		b.metrics.regular.Add(1)
		b.metrics.terminal.Add(1)
		b.metrics.promoted.Add(1)
	}
}

func (b *dataBudget) counts() (int, int, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.regularCount, b.terminalCount, b.candidate != nil
}

func (s *Service) metricValues() slog.Value {
	metrics := s.Metrics()
	attrs := make([]slog.Attr, 0, len(metrics))
	for key, value := range metrics {
		attrs = append(attrs, slog.Int64(key, value))
	}
	return slog.GroupValue(attrs...)
}

// Metrics 可供宿主监控采集；数值也随流收尾写入结构化日志。
func (s *Service) Metrics() map[string]int64 {
	m := &s.metrics
	return map[string]int64{
		"regular_data_streams": m.regular.Load(), "regular_terminal_streams": m.terminal.Load(), "candidate_streams": m.candidates.Load(),
		"limit_rejections": m.limited.Load(), "candidate_timeouts": m.expired.Load(), "candidate_promotions": m.promoted.Load(),
		"stream_open_failures": m.openFailed.Load(), "revocation_closures": m.revoked.Load(),
		"received_bytes": m.received.Load(), "sent_bytes": m.sent.Load(),
	}
}
