package control

import (
	"context"
	"sync"
	"time"
)

type safetyMonitor struct {
	mu     sync.RWMutex
	err    error
	cancel context.CancelFunc
	done   chan struct{}
}

func monitorSafety(ctx context.Context, commands CommandLoop, cfg Config) *safetyMonitor {
	monitor := &safetyMonitor{}
	guard, ok := commands.(interface {
		Guard(context.Context, Config) error
	})
	if !ok || len(cfg.Firecracker) == 0 {
		return monitor
	}
	ctx, cancel := context.WithCancel(ctx)
	monitor.cancel = cancel
	monitor.done = make(chan struct{})
	go func() {
		defer close(monitor.done)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			check, finish := context.WithTimeout(ctx, 20*time.Second)
			err := guard.Guard(check, cfg)
			finish()
			monitor.mu.Lock()
			monitor.err = err
			monitor.mu.Unlock()
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return monitor
}
func (s *safetyMonitor) Error() error { s.mu.RLock(); defer s.mu.RUnlock(); return s.err }
func (s *safetyMonitor) Close() {
	if s.cancel == nil {
		return
	}
	s.cancel()
	select {
	case <-s.done:
	case <-time.After(25 * time.Second):
	}
}
