package worker

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

type usageExecutor struct {
	*fakeExecutor
	fail bool
}

func (e *usageExecutor) Usage(context.Context, lifecycle.Spec) (*lifecycle.Usage, error) {
	if e.fail {
		return nil, errors.New("统计暂不可用")
	}
	return &lifecycle.Usage{At: time.Now().UTC(), CPUCores: new(0.25), MemoryBytes: new(uint64(1024))}, nil
}

func TestUsageReportingAndCompatibility(t *testing.T) {
	for _, tc := range []struct {
		name     string
		protocol int
		fail     bool
	}{
		{"采集并确认", 1, false}, {"旧后台不发送", 0, false}, {"采集失败不影响运行", 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := target(t)
			remote, client := server(t, s)
			remote.usageProtocol = tc.protocol
			executor := &usageExecutor{fakeExecutor: &fakeExecutor{phase: lifecycle.InstanceRunning}, fail: tc.fail}
			w, err := New(directory(t), executor)
			if err != nil {
				t.Fatal(err)
			}
			defer w.Close()
			cfg := control.Config{HostID: "host-test"}
			if err := w.Tick(t.Context(), client, cfg); err != nil {
				t.Fatal(err)
			}
			wait(t, func() bool { w.mu.Lock(); defer w.mu.Unlock(); return w.entries[s.EnvironmentID].Result != nil })
			if err := w.Tick(t.Context(), client, cfg); err != nil {
				t.Fatal(err)
			}
			w.mu.Lock()
			e := w.entries[s.EnvironmentID]
			w.mu.Unlock()
			if !e.Acknowledged || e.Result.Phase != "running" {
				t.Fatal("统计导致状态确认失败", e)
			}
			remote.mu.Lock()
			defer remote.mu.Unlock()
			if len(remote.reports) != 1 || (remote.reports[0].Usage != nil) != (tc.protocol == 1 && !tc.fail) {
				t.Fatal("采集协议未正确协商", remote.reports)
			}
		})
	}
}
