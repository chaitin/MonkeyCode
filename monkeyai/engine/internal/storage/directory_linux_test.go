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
	for _, root := range []bool{false, true} {
		m := manager(t)
		s := spec()
		s.SandboxRoot, s.PersistentContainer = root, root
		uid := uint32(1000)
		if root {
			uid = 0
		}
		mounts, err := m.Ensure(t.Context(), s)
		if err != nil {
			t.Fatal(err)
		}
		for _, mount := range mounts {
			var st unix.Stat_t
			if err := unix.Stat(mount.Source, &st); err != nil {
				t.Fatal(err)
			}
			mode := uint32(0700)
			if root && mount.Target == "/var/lib/monkeyai" {
				mode = 0755
			}
			if st.Uid != uid || st.Gid != uid || st.Mode&0777 != mode {
				t.Fatalf("目录权限不符: %+v", st)
			}
		}
	}
}
