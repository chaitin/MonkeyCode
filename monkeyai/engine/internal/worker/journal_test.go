package worker

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
)

func TestSlowResultWriteDoesNotBlockAnotherEnvironment(t *testing.T) {
	s := target(t)
	remote, client := server(t, s)
	w, err := New(directory(t), &fakeExecutor{})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	entered, release := make(chan struct{}), make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	defer unblock()
	w.persist = func(e entry) error {
		if e.Target.EnvironmentID == s.EnvironmentID && e.Result != nil {
			select {
			case <-entered:
			default:
				close(entered)
			}
			<-release
		}
		return w.writeEntry(e)
	}
	cfg := control.Config{HostID: "test"}
	if err = w.Tick(t.Context(), client, cfg); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("结果未进入写盘阶段")
	}
	other := s
	other.EnvironmentID = "other"
	remote.mu.Lock()
	remote.target = other
	remote.mu.Unlock()
	finished := make(chan error, 1)
	go func() {
		if rows := w.snapshot(s.EnvironmentID); len(rows) != 1 || rows[0].Phase != "" || rows[0].Activity != "applying" {
			finished <- errors.New("未刷盘的结果被提前发布")
			return
		}
		finished <- w.Tick(t.Context(), client, cfg)
	}()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("慢写盘阻塞了查询或其他环境的接单")
	}
	wait(t, func() bool {
		rows := w.snapshot(other.EnvironmentID)
		return len(rows) == 1 && rows[0].Phase == "running" && rows[0].Activity == "idle"
	})
	next := s
	next.Generation++
	next.DesiredState = "stopped"
	remote.mu.Lock()
	remote.target = next
	remote.mu.Unlock()
	if err = w.Tick(t.Context(), client, cfg); err != nil {
		t.Fatal(err)
	}
	if w.snapshot(s.EnvironmentID)[0].Generation != s.Generation {
		t.Fatal("旧结果未落盘就推进了代次")
	}
	unblock()
	wait(t, func() bool { return w.snapshot(s.EnvironmentID)[0].Activity == "idle" })
	if err = w.Tick(t.Context(), client, cfg); err != nil {
		t.Fatal(err)
	}
	wait(t, func() bool {
		row := w.snapshot(s.EnvironmentID)[0]
		return row.Generation == next.Generation && row.Phase == "stopped"
	})
	reopened, err := New(w.root, &fakeExecutor{})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if reopened.snapshot(s.EnvironmentID)[0].Generation != next.Generation {
		t.Fatal("重启后恢复了过期代次")
	}
}
func TestDeadlinePersistsFailureAndReleasesSlot(t *testing.T) {
	for _, inspect := range []bool{false, true} {
		s := target(t)
		w, err := New(directory(t), &fakeExecutor{})
		if err != nil {
			t.Fatal(err)
		}
		e := entry{Target: s}
		reason := "apply_failed"
		if inspect {
			reason = "inspect_failed"
			e.Result = &Observation{Phase: "running"}
		}
		id := s.EnvironmentID
		w.entries[id] = e
		ctx, cancel := context.WithDeadlineCause(t.Context(), time.Now().Add(-time.Second), errJobTimeout)
		w.active[id] = job{cancel: cancel}
		w.execute(ctx, e, false)
		cancel()
		rows := w.snapshot(id)
		if len(rows) != 1 || rows[0].Phase != "failed" || rows[0].Reason != reason || rows[0].Activity != "idle" {
			t.Fatal(rows)
		}
		w.Close()
		restored, err := New(w.root, &fakeExecutor{})
		if err != nil {
			t.Fatal(err)
		}
		if restored.entries[id].Result.Reason != reason {
			t.Fatal("超时结果未落盘")
		}
		restored.Close()
	}
}
func TestFailedJournalWriteKeepsLastPublishedRecord(t *testing.T) {
	s := target(t)
	w, err := New(directory(t), &fakeExecutor{})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	id := s.EnvironmentID
	w.entries[id] = entry{Target: s}
	s.Generation++
	w.persist = func(entry) error { return errors.New("磁盘满") }
	w.mu.Lock()
	err = w.saveLocked(entry{Target: s})
	w.mu.Unlock()
	if err == nil || w.snapshot(id)[0].Generation == s.Generation || len(w.writing) != 0 {
		t.Fatal("写失败后发布了新目标或遗留写入标记")
	}
}
