package control

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"
	"time"
)

type safetyLoop struct {
	calls  atomic.Int64
	called chan struct{}
}

func (s *safetyLoop) SetConcurrency(int, int) error               { return nil }
func (s *safetyLoop) Tick(context.Context, *Client, Config) error { return nil }
func (s *safetyLoop) Close()                                      {}
func (s *safetyLoop) NetworkPolicies(context.Context) []string    { return nil }
func (s *safetyLoop) Guard(ctx context.Context, _ Config) error {
	s.calls.Add(1)
	select {
	case s.called <- struct{}{}:
	default:
	}
	return ctx.Err()
}
func TestSafetyMonitorRunsWithoutHeartbeatOrCommandTick(t *testing.T) {
	loop := &safetyLoop{called: make(chan struct{}, 1)}
	monitor := monitorSafety(t.Context(), loop, Config{Firecracker: json.RawMessage(`{}`)})
	defer monitor.Close()
	select {
	case <-loop.called:
	case <-time.After(time.Second):
		t.Fatal("本地保护未独立于心跳执行")
	}
}
