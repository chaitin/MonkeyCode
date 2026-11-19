package worker

import (
	"context"
	"errors"
	"fmt"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type blockedExecutor struct{ applied, inspected chan string }

func (b blockedExecutor) Apply(ctx context.Context, s lifecycle.Spec) (lifecycle.State, error) {
	b.applied <- s.EnvironmentID
	<-ctx.Done()
	return lifecycle.State{}, ctx.Err()
}
func (b blockedExecutor) Inspect(ctx context.Context, id string) (lifecycle.State, lifecycle.Instance, error) {
	b.inspected <- id
	<-ctx.Done()
	return lifecycle.State{}, lifecycle.Instance{}, ctx.Err()
}
func TestBusyInspectionsLeaveOperationCapacity(t *testing.T) {
	for _, tc := range []struct {
		name                                         string
		operations, inspections, wantOps, wantChecks int
	}{{"默认", 0, 0, 10, 2}, {"分别配置", 3, 1, 3, 1}, {"仅调整巡检", 0, 4, 10, 4}} {
		t.Run(tc.name, func(t *testing.T) { testPoolCapacity(t, tc.operations, tc.inspections, tc.wantOps, tc.wantChecks) })
	}
}
func testPoolCapacity(t *testing.T, operations, inspections, operationSlots, inspectionSlots int) {
	b := blockedExecutor{make(chan string, 16), make(chan string, 16)}
	w, err := New(directory(t), b)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	if err := w.SetConcurrency(operations, inspections); err != nil {
		t.Fatal(err)
	}
	for _, v := range [][2]int{{-1, 1}, {1, 65}} {
		if w.SetConcurrency(v[0], v[1]) == nil {
			t.Fatalf("接受了非法配置 %v", v)
		}
	}
	s := target(t)
	add := func(prefix string, n int, running bool) {
		w.mu.Lock()
		defer w.mu.Unlock()
		for i := range n {
			s.EnvironmentID = fmt.Sprintf("%s-%d", prefix, i)
			e := entry{Target: s}
			if running {
				e.Result = &Observation{Phase: "running"}
			}
			w.entries[s.EnvironmentID] = e
		}
		w.start(t.Context())
	}
	add("a", inspectionSlots+1, true)
	wait(t, func() bool { return len(b.inspected) == inspectionSlots })
	add("z", operationSlots+1, false)
	wait(t, func() bool { return len(b.applied) == operationSlots })
	rows := w.snapshot("")
	counts := map[string]int{}
	for _, r := range rows {
		counts[r.Activity]++
	}
	if counts["applying"] != operationSlots || counts["inspecting"] != inspectionSlots || counts["queued"] != 1 {
		t.Fatal(counts)
	}
	w.mu.Lock()
	w.start(t.Context())
	active := len(w.active)
	w.mu.Unlock()
	if active != operationSlots+inspectionSlots {
		t.Fatal("超出池容量", active)
	}
}
func TestConcurrentApprovalsKeepSignedRepliesSeparate(t *testing.T) {
	s := target(t)
	remote, client := server(t, s)
	w, err := New(directory(t), &fakeExecutor{})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	request := func(id string) chan error {
		ch := make(chan error, 1)
		go func() { ch <- w.approve(ctx, standalone.Request{EnvironmentID: id, Generation: 1}) }()
		return ch
	}
	pending := func(n int) { wait(t, func() bool { w.mu.Lock(); defer w.mu.Unlock(); return len(w.approvals) == n }) }
	a := request("a")
	pending(1)
	b := request("b")
	pending(2)
	cfg := control.Config{HostID: "host"}
	remote.mu.Lock()
	remote.denyRuntime = true
	remote.mu.Unlock()
	if err = w.Tick(ctx, client, cfg); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-a:
		if err == nil {
			t.Fatal("拒绝未送达")
		}
	case <-time.After(time.Second):
		t.Fatal("授权等待超时")
	}
	pending(1)
	remote.mu.Lock()
	remote.denyRuntime = false
	remote.mu.Unlock()
	if err = w.Tick(ctx, client, cfg); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-b:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("授权等待超时")
	}
	pending(0)
	remote.mu.Lock()
	defer remote.mu.Unlock()
	if len(remote.requests) != 2 || remote.requests[0].EnvironmentID != "a" || remote.requests[1].EnvironmentID != "b" {
		t.Fatal(remote.requests)
	}
}
func TestDiagnosticsShowsQueuedEnvironmentBeforeStateExists(t *testing.T) {
	root, err := os.MkdirTemp("/tmp", "engine-diag-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	w, err := New(filepath.Join(root, "commands"), &fakeExecutor{})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	s := target(t)
	if err = w.save(entry{Target: s}); err != nil {
		t.Fatal(err)
	}
	stop, err := w.Diagnostics()
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	socket := filepath.Join(root, "worker.sock")
	st, err := os.Stat(socket)
	if err != nil || st.Mode().Perm() != 0600 {
		t.Fatal(err, st)
	}
	rows, err := Query(t.Context(), socket, s.EnvironmentID)
	if err != nil || len(rows) != 1 || rows[0].Activity != "queued" || rows[0].Generation != s.Generation {
		t.Fatal(rows, err)
	}
	rows, err = Query(t.Context(), socket, "missing")
	if err != nil || len(rows) != 0 {
		t.Fatal(rows, err)
	}
	if _, err = os.Stat(filepath.Join(root, "environments")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("诊断创建了环境状态")
	}
}
