package firecracker

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
	h, err := NewSystemHost(HostConfig{Root: filepath.Join(root, "data"), SocketRoot: filepath.Join(root, "s"), Firecracker: vmimage.Tool{Path: "/trusted/firecracker"}, OverheadMiB: 128, DiskRate: sampleConfig().Disk.Rate, Network: fakeNetwork{}})
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
		if err := h.emptyCgroup(strings.Repeat("a", 64), group); err == nil {
			t.Fatal("接受不安全cgroup", group)
		}
	}
}
func TestCopiedKernelIsReadableByVMM(t *testing.T) {
	root := t.TempDir()
	source, destination := filepath.Join(root, "fixed-kernel"), filepath.Join(root, "jailed-kernel")
	if err := os.WriteFile(source, []byte("fixed kernel"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := copyKernel(t.Context(), source, destination); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(destination)
	if err != nil || info.Mode().Perm() != 0444 {
		t.Fatal("隔离VMM无法读取内核", info, err)
	}
	data, err := os.ReadFile(destination)
	if err != nil || string(data) != "fixed kernel" {
		t.Fatal(string(data), err)
	}
}

func TestJailerReceivesOnlyOneInstanceID(t *testing.T) {
	h := systemFixture(t)
	lease := NetworkLease{UID: 100001, Namespace: "/run/netns/mfc-test"}
	for _, selftest := range []bool{false, true} {
		launch := Launch{ID: strings.Repeat("a", 64), BootID: "boot-1", VCPUs: 1, MemoryMiB: 256, SelfTest: selftest}
		args := h.launchCommand(launch, lease)
		separators, ids := 0, 0
		for index, arg := range args {
			if arg == "--" {
				separators++
			}
			if arg == "--id" {
				ids++
				if separators != 1 || index+1 >= len(args) || args[index+1] != launch.ID {
					t.Fatal("实例ID必须只传给jailer，由jailer自动注入Firecracker", args)
				}
			}
		}
		if separators != 2 || ids != 1 || strings.Contains(strings.Join(args, " "), "--daemonize") {
			t.Fatal("jailer实例参数不合法，或脱离systemd进程管理", args)
		}
		text := strings.Join(args, " ")
		output := "--property=StandardOutput=null"
		if selftest {
			output = "--property=StandardOutput=journal"
		}
		if !strings.Contains(text, output) || !strings.Contains(text, "--property=StandardError=journal") {
			t.Fatal("未保留启动错误日志，或非自检环境的控制台被记录", args)
		}
	}
}

func TestAPIStartupReportsEarlyExitAndJournal(t *testing.T) {
	h := systemFixture(t)
	record := saveHostRecord(t, h)
	client, err := NewClient(h.socket(record.ID))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	started := time.Now()
	calls := 0
	h.command = func(ctx context.Context, name string, args ...string) ([]byte, error) {
		calls++
		if name == "systemctl" {
			return []byte("LoadState=loaded\nActiveState=failed\nDescription=MonkeyAI Firecracker boot-1\nMainPID=0\nResult=exit-code\nExecMainStatus=153\n"), nil
		}
		if name != "journalctl" || !strings.Contains(strings.Join(args, " "), "--unit="+Unit(record.ID)) || !strings.Contains(strings.Join(args, " "), "--since=@") {
			t.Fatal("日志查询未限定实例和本次启动时间", name, args)
		}
		return []byte("Arguments parsing error: The argument 'id' was provided more than once."), nil
	}
	err = h.waitAPI(t.Context(), client, record, started)
	if err == nil || !strings.Contains(err.Error(), "status=153") || !strings.Contains(err.Error(), "provided more than once") || calls != 2 {
		t.Fatal("提前退出未报告原始日志或仍反复等待API", calls, err)
	}
}

func TestStartupDiagnosticPreservesCauseAndLimitsOutput(t *testing.T) {
	h := systemFixture(t)
	record := saveHostRecord(t, h)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	cause := errors.New("API startup failed")
	for _, broken := range []bool{false, true} {
		h.command = func(ctx context.Context, name string, args ...string) ([]byte, error) {
			if ctx.Err() != nil {
				t.Fatal("日志读取复用了已取消的启动上下文")
			}
			if broken {
				return nil, errors.New("journal unavailable")
			}
			return []byte(strings.Repeat("x", 10000) + " last diagnostic"), nil
		}
		err := h.startError(ctx, record, time.Now(), cause)
		if !errors.Is(err, cause) || len(err.Error()) > 9000 {
			t.Fatal("丢失启动原因或日志未限长", err)
		}
		want := "last diagnostic"
		if broken {
			want = "journal unavailable"
		}
		if !strings.Contains(err.Error(), want) {
			t.Fatal("丢失最后日志或采集失败原因", err)
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
