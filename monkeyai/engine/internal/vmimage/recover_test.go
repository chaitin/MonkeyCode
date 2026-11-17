package vmimage

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRecoveryReleasesIdentityOnlyAfterWriterExit(t *testing.T) {
	for _, mode := range []string{"writer-active", "identity-active", "exited"} {
		t.Run(mode, func(t *testing.T) {
			root := t.TempDir()
			stage := filepath.Join(root, "stage")
			if err := os.Mkdir(stage, 0700); err != nil {
				t.Fatal(err)
			}
			unit := "ma-cvt-aaaaaaaaaaaaaaaaaaaaaaaa.service"
			if err := saveConversionJob(stage, unit); err != nil {
				t.Fatal(err)
			}
			calls := filepath.Join(root, "calls")
			t.Setenv("VM_IMAGE_TEST_CALLS", calls)
			t.Setenv("VM_IMAGE_TEST_PHASE", mode)
			script := `#!/bin/sh
printf '%s\n' "$*" >> "$VM_IMAGE_TEST_CALLS"
case "$1" in
 stop) exit 0 ;;
 show)
  active=inactive
  case "$2" in
   *-identity.service) test "$VM_IMAGE_TEST_PHASE" != identity-active || active=active ;;
   *) test "$VM_IMAGE_TEST_PHASE" != writer-active || active=active ;;
  esac
  printf 'LoadState=loaded\nActiveState=%s\nMainPID=0\nControlGroup=\n' "$active"
 ;;
esac
`
			if err := os.WriteFile(filepath.Join(root, "systemctl"), []byte(script), 0700); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", root+string(os.PathListSeparator)+os.Getenv("PATH"))
			err := recoverConversion(t.Context(), stage)
			data, readErr := os.ReadFile(calls)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if mode == "exited" {
				if err != nil {
					t.Fatal(err)
				}
				if _, err := os.Stat(stage); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("退出后未清理暂存区", err)
				}
				if !strings.Contains(string(data), "stop "+identityUnit(unit)) {
					t.Fatal("动态身份未释放", string(data))
				}
			} else {
				if !errors.Is(err, ErrConversionCleanup) {
					t.Fatal("未保留不确定资源", err)
				}
				if _, err := os.Stat(stage); err != nil {
					t.Fatal("提前删除暂存区", err)
				}
				if mode == "writer-active" && strings.Contains(string(data), "stop ") {
					t.Fatal("写入者退出前释放动态身份", string(data))
				}
			}
		})
	}
}

func TestRecoveryRequiresInactiveOwnedProcessGroup(t *testing.T) {
	for _, mode := range []string{"running", "wrong-group", "exited"} {
		t.Run(mode, func(t *testing.T) {
			root, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			stage := filepath.Join(root, "stage")
			if err := os.Mkdir(stage, 0700); err != nil {
				t.Fatal(err)
			}
			state := "LoadState=not-found\nMainPID=0\nControlGroup=\nActiveState=inactive\n"
			if mode == "running" {
				state = "LoadState=loaded\nMainPID=1\nActiveState=active\n"
			}
			if mode == "wrong-group" {
				state = "LoadState=loaded\nMainPID=0\nActiveState=inactive\nControlGroup=/system.slice/other.service\n"
			}
			err = cleanConversionState(stage, "ma-cvt-aaaaaaaaaaaaaaaaaaaaaaaa.service", state)
			if mode == "exited" {
				if err != nil {
					t.Fatal(err)
				}
				if _, err := os.Stat(stage); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("确认退出未回收暂存区", err)
				}
			} else {
				if err == nil {
					t.Fatal("未确认归属或退出仍回收")
				}
				if _, err := os.Stat(stage); err != nil {
					t.Fatal("未确认退出就删除", err)
				}
			}
		})
	}
}
