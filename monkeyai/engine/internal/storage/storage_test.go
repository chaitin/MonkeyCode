package storage

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

type quota struct {
	assigned map[string]uint32
	limits   map[uint32]int64
	fail     bool
}

func (q *quota) Check(context.Context, string) error                     { return nil }
func (q *quota) Available(context.Context, string, uint32) (bool, error) { return true, nil }
func (q *quota) Reserve(context.Context, string, int64, int64) error     { return nil }
func (q *quota) Assign(_ context.Context, path string, id uint32) error {
	q.assigned[path] = id
	return nil
}
func (q *quota) Limit(_ context.Context, _ string, id uint32, bytes, inodes int64) error {
	if q.fail {
		return errors.New("配额失败")
	}
	q.limits[id] = bytes
	return nil
}
func spec() lifecycle.Spec {
	digest := "sha256:" + strings.Repeat("b", 64)
	return lifecycle.Spec{EnvironmentID: "env", InstanceID: "one", Generation: 1, DesiredState: lifecycle.DesiredRunning, Driver: "gvisor", Image: "example.com/image@" + digest, ImageDigest: digest, NetworkPolicy: "isolated", Resource: lifecycle.Resource{CPUMillis: 1000, MemoryBytes: 1 << 30, HostTasks: 512, TemporaryBytes: 64 << 20}, Volumes: []lifecycle.Volume{{ID: "project", Purpose: "workspace", Bytes: 1 << 30, Inodes: 10000}, {ID: "home", Purpose: "home", Bytes: 1 << 30, Inodes: 10000}, {ID: "runtime", Purpose: "runtime", Bytes: 1 << 30, Inodes: 10000}}}
}
func manager(t *testing.T) (*Manager, *quota) {
	t.Helper()
	q := &quota{assigned: map[string]uint32{}, limits: map[uint32]int64{}}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	m, err := New(filepath.Join(root, "storage"), q)
	if err != nil {
		t.Fatal(err)
	}
	return m, q
}
func TestRebuildRetainsFilesAndProjectIDs(t *testing.T) {
	m, q := manager(t)
	s := spec()
	mounts, err := m.Ensure(t.Context(), s)
	if err != nil {
		t.Fatal(err)
	}
	f := filepath.Join(mounts[0].Source, "user-file")
	if err := os.WriteFile(f, []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	project := q.assigned[mounts[0].Source]
	s.InstanceID = "two"
	s.Generation = 3
	next, err := m.Ensure(t.Context(), s)
	if err != nil {
		t.Fatal(err)
	}
	if next[0] != mounts[0] || q.assigned[next[0].Source] != project {
		t.Fatal("重建改变卷映射")
	}
	if raw, err := os.ReadFile(f); err != nil || string(raw) != "preserve" {
		t.Fatal("重建破坏用户文件")
	}
	s.EnvironmentID = "another"
	if _, err := m.Ensure(t.Context(), s); err == nil {
		t.Fatal("允许跨环境复用卷")
	}
}
func TestQuotaFailureResumesSameProjectWithoutShrink(t *testing.T) {
	m, q := manager(t)
	s := spec()
	q.fail = true
	if _, err := m.Ensure(t.Context(), s); err == nil {
		t.Fatal("配额失败仍返回挂载")
	}
	raw, _ := os.ReadFile(filepath.Join(m.root, "volumes.json"))
	var records map[string]Record
	json.Unmarshal(raw, &records)
	reserved := records["project"].Project
	if records["project"].Ready {
		t.Fatal("未成功的卷被标为就绪")
	}
	q.fail = false
	mounts, err := m.Ensure(t.Context(), s)
	if err != nil {
		t.Fatal(err)
	}
	if q.assigned[mounts[0].Source] != reserved {
		t.Fatal("失败重试泄漏项目 ID")
	}
	s.Volumes[0].Bytes /= 2
	if _, err := m.Ensure(t.Context(), s); err == nil {
		t.Fatal("接受缩容")
	}
}
func TestMissingMappingAndSymlinkFailClosed(t *testing.T) {
	m, _ := manager(t)
	s := spec()
	mounts, err := m.Ensure(t.Context(), s)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(mounts[0].Source); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), mounts[0].Source); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Ensure(t.Context(), s); err == nil {
		t.Fatal("接受符号链接卷")
	}
	os.Remove(filepath.Join(m.root, "volumes.json"))
	if _, err := m.Ensure(t.Context(), s); err == nil {
		t.Fatal("映射丢失后重新分配项目 ID")
	}
}
