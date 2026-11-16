//go:build linux

package vmdisk

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestExt4Integration(t *testing.T) {
	if os.Getenv("MONKEYAI_EXT4_TEST") != "1" {
		t.Skip("需显式启用隔离 Linux ext4 验收")
	}
	mkfs, err := exec.LookPath("mke2fs")
	if err != nil {
		t.Fatal(err)
	}
	debugfs, err := exec.LookPath("debugfs")
	if err != nil {
		t.Fatal(err)
	}
	base := t.TempDir()
	root := filepath.Join(base, "rootfs")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "proof"), []byte("persistent-proof"), 0644); err != nil {
		t.Fatal(err)
	}
	formatter, err := NewExt4(mkfs)
	if err != nil {
		t.Fatal(err)
	}
	disk := filepath.Join(base, "root.ext4")
	if err := formatter.Populate(context.Background(), disk, 64<<20, root); err != nil {
		t.Fatal(err)
	}
	data, err := exec.Command(debugfs, "-R", "cat /proof", disk).CombinedOutput()
	if err != nil || !strings.Contains(string(data), "persistent-proof") {
		t.Fatalf("ext4文件内容不符: %s %v", data, err)
	}
	cloned := filepath.Join(base, "clone.ext4")
	if err := Copy(context.Background(), disk, cloned); err != nil {
		t.Fatal(err)
	}
	data, err = exec.Command(debugfs, "-R", "cat /proof", cloned).CombinedOutput()
	if err != nil || !strings.Contains(string(data), "persistent-proof") {
		t.Fatalf("复制后ext4内容不符: %s %v", data, err)
	}
}
