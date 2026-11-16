package vmdisk

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestCopy(t *testing.T) {
	dir := t.TempDir()
	source, destination := filepath.Join(dir, "template.raw"), filepath.Join(dir, "system.raw")
	data := make([]byte, 3*1024*1024+17)
	copy(data, "ext4-header")
	copy(data[len(data)-17:], "persistent-tail")
	if err := os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := Copy(context.Background(), source, destination); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, data) {
		t.Fatal("磁盘内容不一致")
	}
	info, err := os.Stat(destination)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("权限: %o", info.Mode().Perm())
	}
	if err := Copy(context.Background(), source, destination); !errors.Is(err, os.ErrExist) {
		t.Fatalf("应拒绝覆盖: %v", err)
	}
	if err := os.WriteFile(source, []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	got, err = os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, data) {
		t.Fatal("模板修改影响实例磁盘")
	}
}

func TestCopyCancelled(t *testing.T) {
	dir := t.TempDir()
	source, destination := filepath.Join(dir, "source"), filepath.Join(dir, "disk")
	if err := os.WriteFile(source, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := Copy(ctx, source, destination); !errors.Is(err, context.Canceled) {
		t.Fatalf("取消: %v", err)
	}
	if _, err := os.Stat(destination); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("残留磁盘: %v", err)
	}
}

func TestCopyRejectsSymlink(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source")
	link := filepath.Join(dir, "link")
	if err := os.WriteFile(source, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(source, link); err != nil {
		t.Fatal(err)
	}
	if err := Copy(context.Background(), link, filepath.Join(dir, "disk")); err == nil {
		t.Fatal("应拒绝模板符号链接")
	}
}
