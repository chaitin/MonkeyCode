package storage

import (
	"golang.org/x/sys/unix"
	"os"
	"testing"
)

func TestDirectoryPermissions(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("需要 root 验证工作负载 UID/GID")
	}
	m := manager(t)
	mounts, err := m.Ensure(t.Context(), spec())
	if err != nil {
		t.Fatal(err)
	}
	for _, mount := range mounts {
		var st unix.Stat_t
		if err := unix.Stat(mount.Source, &st); err != nil {
			t.Fatal(err)
		}
		if st.Uid != 1000 || st.Gid != 1000 || st.Mode&0777 != 0700 {
			t.Fatalf("目录权限不符: %+v", st)
		}
	}
}
