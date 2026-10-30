//go:build linux || darwin

package control

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLockExcludesConcurrentOperationsAndRejectsLinks(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "lock")
	unlock, err := Lock(path)
	if err != nil {
		t.Fatal(err)
	}
	if release, err := Lock(path); err == nil {
		release()
		t.Fatal("并发操作未被排除")
	}
	unlock()
	release, err := Lock(path)
	if err != nil {
		t.Fatal(err)
	}
	release()
	link := filepath.Join(dir, "link")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if release, err := Lock(link); err == nil {
		release()
		t.Fatal("接受链接锁文件")
	}
}
