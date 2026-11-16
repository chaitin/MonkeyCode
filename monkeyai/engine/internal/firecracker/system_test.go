package firecracker

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/guest"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmimage"
)

type fakeNetwork struct{}

func (fakeNetwork) Prepare(context.Context, string) (NetworkLease, error) {
	return NetworkLease{}, errors.New("not prepared")
}
func (fakeNetwork) Verify(context.Context, string, NetworkLease) error { return nil }
func (fakeNetwork) Remove(context.Context, string, NetworkLease) error { return nil }
func systemFixture(t *testing.T) *SystemHost {
	t.Helper()
	root, err := os.MkdirTemp("/tmp", "fch-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(root) })
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	h, err := NewSystemHost(HostConfig{Root: filepath.Join(root, "data"), SocketRoot: filepath.Join(root, "s"), Firecracker: vmimage.Tool{Path: "/trusted/firecracker"}, OverheadMiB: 128, DiskRate: sampleConfig().System.Rate, Network: fakeNetwork{}})
	if err != nil {
		t.Fatal(err)
	}
	return h
}
func saveHostRecord(t *testing.T, h *SystemHost) hostRecord {
	t.Helper()
	b := guest.Binding{EnvironmentID: "env-1", InstanceID: "instance-1", BootID: "boot-1"}
	record := hostRecord{ID: storage.Key(b.EnvironmentID), BootID: b.BootID, Binding: b, Network: NetworkLease{UID: 100001}}
	raw, _ := json.Marshal(record)
	if err := os.WriteFile(h.recordPath(record.ID), raw, 0600); err != nil {
		t.Fatal(err)
	}
	return record
}
func TestSystemHostRejectsUnknownServiceOwnership(t *testing.T) {
	h := systemFixture(t)
	record := saveHostRecord(t, h)
	calls := 0
	h.command = func(ctx context.Context, name string, args ...string) ([]byte, error) {
		calls++
		return []byte("LoadState=loaded\nActiveState=inactive\nMainPID=0\nDescription=foreign service\n"), nil
	}
	if _, err := h.Running(t.Context(), record.ID); err == nil {
		t.Fatal("接受未知服务")
	}
	if err := h.Stop(t.Context(), record.ID); err == nil {
		t.Fatal("停止了未知服务")
	}
	if calls != 2 {
		t.Fatal("归属检查后仍执行了变更", calls)
	}
}
func TestSystemHostRequiresConfirmedProcessExit(t *testing.T) {
	h := systemFixture(t)
	record := saveHostRecord(t, h)
	for _, pid := range []string{"0", "1234"} {
		h.command = func(context.Context, string, ...string) ([]byte, error) {
			return []byte("LoadState=loaded\nActiveState=inactive\nDescription=MonkeyAI Firecracker boot-1\nMainPID=" + pid + "\n"), nil
		}
		running, err := h.Running(t.Context(), record.ID)
		if pid == "0" {
			if running || err != nil {
				t.Fatal(running, err)
			}
		} else if err == nil {
			t.Fatal("仍有主进程却报告停止")
		}
	}
}
func TestSystemHostRejectsUnsafeControlGroup(t *testing.T) {
	h := systemFixture(t)
	for _, group := range []string{"/system.slice/docker.service", "/system.slice/monkeyai-fc-abc/../../docker.service", "relative"} {
		if err := h.emptyCgroup(group); err == nil {
			t.Fatal("接受不安全cgroup", group)
		}
	}
}
func TestBoundedHostCommandOutput(t *testing.T) {
	var out boundedOutput
	data := []byte(strings.Repeat("x", 100000))
	n, err := out.Write(data)
	if err != nil || n != len(data) || len(out.data) != 64<<10 || !out.exceeded {
		t.Fatal(n, err, len(out.data))
	}
}
