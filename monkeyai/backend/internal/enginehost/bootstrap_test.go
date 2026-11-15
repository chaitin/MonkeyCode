package enginehost

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

func bootstrapCommand(t *testing.T, modern bool, status string) (*exec.Cmd, string) {
	t.Helper()
	if os.PathSeparator == '\\' {
		t.Skip("需要POSIX shell")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "bin")
	if err := os.Mkdir(bin, 0700); err != nil {
		t.Fatal(err)
	}
	fixture := []byte("#!/bin/sh\nprintf 'run\\n' >> \"$MARKER\"\nif [ -n \"${GATE:-}\" ]; then while [ ! -f \"$GATE\" ]; do sleep 0.05; done; fi\nexit \"$INSTALL_EXIT\"\n")
	source := filepath.Join(dir, "installer")
	if err := os.WriteFile(source, fixture, 0700); err != nil {
		t.Fatal(err)
	}
	mocks := map[string]string{
		"uname": `case "$1" in -s) echo Linux;; -m) echo aarch64;; esac`,
		"id":    `echo 0`,
		"curl":  `while [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; cp "$FIXTURE" "$1"; printf '%s' "$1" > "$WORK_FILE"; exit 0; fi; shift; done; exit 1`,
		"systemd-run": `help=false
for arg do [ "$arg" != --help ] || help=true; done
for arg do
 case "$arg" in
  --wait|--pipe|--collect|--pty|-p|--property=*) exit 99 ;;
  -t)
   if [ "${NO_TTY:-0}" = 1 ]; then exit 99; fi
   if [ "$help" = false ] && [ "${RUNTIME_PTY_REJECT:-0}" = 1 ]; then touch "$RUN_ARGS.pty-rejected"; exit 99; fi
   ;;
 esac
done
if [ "$help" = true ]; then
 if [ "$MODERN" = 1 ]; then printf '%s\n' --wait --pipe --pty --collect; else printf 'PTY (--pty) is not supported.\n'; fi
 exit 0
fi
printf '%s\n' "$@" > "$RUN_ARGS"
[ "${LAUNCH_FAIL:-0}" = 0 ] || exit 1
if [ "${SIGNAL_EXIT:-0}" = 1 ]; then printf '9' > "$UNIT_RESULT"; exit 0; fi
while [ "$1" != /bin/sh ]; do shift; done
if [ "${PTY_FAIL_AFTER_START:-0}" = 1 ]; then "$@"; printf '%s' "$?" > "$UNIT_RESULT"; exit 1; fi
( "$@"; printf '%s' "$?" > "$UNIT_RESULT" ) > "$UNIT_LOG" 2>&1 </dev/null &
exit 0`,
		"systemctl": `for arg do case "$arg" in --value|--wait) exit 99;; esac; done
if [ "$1" != show ]; then exit 0; fi
if [ ! -f "$RUN_ARGS" ]; then printf 'LoadState=not-found\nActiveState=inactive\n'; exit 0; fi
if [ -f "$UNIT_RESULT" ]; then
 status=$(cat "$UNIT_RESULT");code=1
 if [ "$status" = 0 ]; then active=active;sub=exited;result=success;else active=failed;sub=failed;result=exit-code;fi
 if [ "${SIGNAL_EXIT:-0}" = 1 ]; then code=2;status=9;result=signal;fi
else active=active;sub=running;result=success;code=0;status=0;fi
printf 'LoadState=loaded\nActiveState=%s\nSubState=%s\nResult=%s\nExecMainCode=%s\nExecMainStatus=%s\n' "$active" "$sub" "$result" "$code" "$status"`,
		"journalctl": `[ ! -f "$UNIT_LOG" ] || cat "$UNIT_LOG";exit 0`,
	}
	for name, body := range mocks {
		if err := os.WriteFile(filepath.Join(bin, name), []byte("#!/bin/sh\n"+body+"\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile("install.sh")
	if err != nil {
		t.Fatal(err)
	}
	script := strings.Replace(string(raw), "[ -d /run/systemd/system ] || fail '宿主需要运行 systemd'", "true", 1)
	path := filepath.Join(dir, "bootstrap.sh")
	if err := os.WriteFile(path, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(fixture)
	mode := "0"
	if modern {
		mode = "1"
	}
	cmd := exec.Command("sh", path, "https://fixture.example", "fixture-token", "v1", "arm64", hex.EncodeToString(hash[:]), strings.Repeat("a", 64), "/data/engine", "installer")
	cmd.Env = append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"), "FIXTURE="+source, "MARKER="+filepath.Join(dir, "executed"), "WORK_FILE="+filepath.Join(dir, "work"), "MODERN="+mode, "INSTALL_EXIT="+status, "RUN_ARGS="+filepath.Join(dir, "args"), "UNIT_RESULT="+filepath.Join(dir, "result"), "UNIT_LOG="+filepath.Join(dir, "journal"))
	return cmd, dir
}

func TestBootstrapModernAndSystemd219(t *testing.T) {
	for _, tc := range []struct {
		name   string
		modern bool
		exit   string
		want   int
		extra  string
	}{
		{"modern", true, "0", 0, ""}, {"modern-failure", true, "7", 7, ""}, {"systemd219", false, "0", 0, ""}, {"systemd219-failure", false, "23", 23, ""}, {"systemd219-signal", false, "0", 137, "SIGNAL_EXIT=1"}, {"launch-failure", false, "0", 1, "LAUNCH_FAIL=1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cmd, dir := bootstrapCommand(t, tc.modern, tc.exit)
			if tc.extra != "" {
				cmd.Env = append(cmd.Env, tc.extra)
			}
			out, err := cmd.CombinedOutput()
			got := 0
			if err != nil {
				var status *exec.ExitError
				if !errors.As(err, &status) {
					t.Fatal(err)
				}
				got = status.ExitCode()
			}
			if got != tc.want {
				t.Fatalf("退出码=%d，预期%d，输出=%s", got, tc.want, out)
			}
			args, _ := os.ReadFile(filepath.Join(dir, "args"))
			if !tc.modern {
				for _, flag := range []string{"--wait", "--pipe", "--collect", "--pty", "--property="} {
					if strings.Contains(string(args), flag) {
						t.Fatal("向旧systemd发送不支持参数", flag)
					}
				}
			}
			work, err := os.ReadFile(filepath.Join(dir, "work"))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(filepath.Dir(string(work))); !os.IsNotExist(err) {
				t.Fatal("任务结束未清理临时资源", string(work), err)
			}
			if tc.extra != "LAUNCH_FAIL=1" && tc.extra != "SIGNAL_EXIT=1" {
				if _, err := os.Stat(filepath.Join(dir, "executed")); err != nil {
					t.Fatal("安装器未执行", err)
				}
			}
		})
	}
}

func TestBootstrapDisconnectDoesNotRemoveRunningInstaller(t *testing.T) {
	cmd, dir := bootstrapCommand(t, false, "0")
	gate := filepath.Join(dir, "release")
	cmd.Env = append(cmd.Env, "GATE="+gate)
	log, err := os.Create(filepath.Join(dir, "output"))
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	cmd.Stdout, cmd.Stderr = log, log
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	waitFile := func(path string, exists bool) {
		t.Helper()
		end := time.Now().Add(5 * time.Second)
		for time.Now().Before(end) {
			_, err := os.Stat(path)
			if (err == nil) == exists {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatal("等待文件状态超时", path, exists)
	}
	waitFile(filepath.Join(dir, "executed"), true)
	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	work, err := os.ReadFile(filepath.Join(dir, "work"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(string(work)); err != nil {
		t.Fatal("控制终端断开删除了运行资源", err)
	}
	if err := os.WriteFile(gate, []byte("continue"), 0600); err != nil {
		t.Fatal(err)
	}
	waitFile(filepath.Dir(string(work)), false)
}

func TestBootstrapTTYUsesMinimalArguments(t *testing.T) {
	if _, err := exec.LookPath("script"); err != nil {
		t.Skip("需要script创建测试终端")
	}
	for _, tc := range []struct {
		name     string
		env      []string
		status   string
		want     string
		rejected bool
		pty      bool
	}{
		{"short-tty", nil, "0", "0", false, true},
		{"no-tty", []string{"NO_TTY=1"}, "0", "0", false, false},
		{"runtime-reject", []string{"RUNTIME_PTY_REJECT=1"}, "0", "0", true, false},
		{"already-started", []string{"PTY_SUPPORTED=1", "PTY_FAIL_AFTER_START=1"}, "23", "23", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			base, dir := bootstrapCommand(t, false, tc.status)
			statusFile := filepath.Join(dir, "parent-status")
			args := make([]string, len(base.Args))
			for i, arg := range base.Args {
				args[i] = quote(arg)
			}
			line := strings.Join(args, " ") + "; bootstrap_exit=$?; printf '%s' \"$bootstrap_exit\" > " + quote(statusFile) + "; exit \"$bootstrap_exit\""
			var cmd *exec.Cmd
			if runtime.GOOS == "darwin" {
				cmd = exec.Command("script", "-q", filepath.Join(dir, "transcript"), "sh", "-c", line)
			} else {
				cmd = exec.Command("script", "-q", "-e", "-c", line, filepath.Join(dir, "transcript"))
			}
			cmd.Env = append(base.Env, tc.env...)
			out, err := cmd.CombinedOutput()
			status, readErr := os.ReadFile(statusFile)
			if readErr != nil || string(status) != tc.want {
				t.Fatalf("终端安装结果=%s err=%v/%v output=%s", status, readErr, err, out)
			}
			marker, err := os.ReadFile(filepath.Join(dir, "executed"))
			if err != nil || strings.Count(string(marker), "run\n") != 1 {
				t.Fatal("安装器未执行或重复执行", string(marker), err)
			}
			launch, err := os.ReadFile(filepath.Join(dir, "args"))
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(launch), "-t\n") != tc.pty {
				t.Fatal("PTY选择错误", string(launch))
			}
			_, rejectedErr := os.Stat(filepath.Join(dir, "args.pty-rejected"))
			if (rejectedErr == nil) != tc.rejected {
				t.Fatal("未覆盖PTY运行时拒绝", rejectedErr)
			}
			work, err := os.ReadFile(filepath.Join(dir, "work"))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(filepath.Dir(string(work))); !os.IsNotExist(err) {
				t.Fatal("终端任务结束未清理资源", err)
			}
		})
	}
}
