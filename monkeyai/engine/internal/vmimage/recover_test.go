package vmimage

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

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
