package cache

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestDiskDoesNotFollowSymlinksAndHonorsCancellation(t *testing.T) {
	root := t.TempDir()
	p, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/proc", filepath.Join(p, "link")); err != nil {
		t.Fatal(err)
	}
	u, err := Disk(t.Context(), p)
	if err != nil || u.Bytes < 0 || u.FreeBytes <= 0 {
		t.Fatal(u, err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := Disk(ctx, p); err != context.Canceled {
		t.Fatal(err)
	}
	if _, err := Disk(t.Context(), filepath.Join(p, "link")); err == nil {
		t.Fatal("接受链接作为根目录")
	}
}
