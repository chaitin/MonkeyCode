package storage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func spec() lifecycle.Spec {
	digest := "sha256:" + strings.Repeat("b", 64)
	return lifecycle.Spec{EnvironmentID: "env", InstanceID: "one", Generation: 1, DesiredState: lifecycle.DesiredRunning, Driver: "gvisor", Image: "example.com/image@" + digest, ImageDigest: digest, NetworkPolicy: "isolated", Resource: lifecycle.Resource{CPUMillis: 1000, MemoryBytes: 1 << 30, HostTasks: 512, TemporaryBytes: 64 << 20}, Volumes: []lifecycle.Volume{{ID: "project", Purpose: "workspace", Bytes: 1 << 30, Inodes: 10000}, {ID: "home", Purpose: "home", Bytes: 1 << 30, Inodes: 10000}, {ID: "runtime", Purpose: "runtime", Bytes: 1 << 30, Inodes: 10000}}}
}
func manager(t *testing.T) *Manager {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	m, err := New(filepath.Join(root, "storage"))
	if err != nil {
		t.Fatal(err)
	}
	return m
}
func TestRebuildRetainsFilesAndDirectories(t *testing.T) {
	m := manager(t)
	s := spec()
	mounts, err := m.Ensure(t.Context(), s)
	if err != nil {
		t.Fatal(err)
	}
	f := filepath.Join(mounts[0].Source, "user-file")
	if err := os.WriteFile(f, []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	s.InstanceID = "two"
	s.Generation = 3
	next, err := m.Ensure(t.Context(), s)
	if err != nil {
		t.Fatal(err)
	}
	if next[0] != mounts[0] {
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
func TestOrdinaryDirectoriesIgnoreLegacyLimits(t *testing.T) {
	m := manager(t)
	s := spec()
	for i := range s.Volumes {
		s.Volumes[i].Bytes = 0
		s.Volumes[i].Inodes = 0
	}
	mounts, err := m.Ensure(t.Context(), s)
	if err != nil {
		t.Fatal(err)
	}
	for _, mount := range mounts {
		if err := os.WriteFile(filepath.Join(mount.Source, "file"), []byte("keep"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	// 旧协议可能继续携带容量，目录管理不据此设置或调整配额。
	s = spec()
	if _, err := m.Ensure(t.Context(), s); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(m.root, "volumes.json"))
	if err != nil {
		t.Fatal(err)
	}
	var records map[string]Record
	if err := json.Unmarshal(raw, &records); err != nil {
		t.Fatal(err)
	}
	for _, r := range records {
		if r.Project != 0 || !r.Ready {
			t.Fatal("目录状态异常")
		}
	}
	r := records["project"]
	r.Project = 10000
	records["project"] = r
	raw, _ = json.Marshal(records)
	if err := os.WriteFile(filepath.Join(m.root, "volumes.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Ensure(t.Context(), s); err == nil {
		t.Fatal("不能静默接管带旧配额的卷")
	}
	if data, err := os.ReadFile(filepath.Join(mounts[0].Source, "file")); err != nil || string(data) != "keep" {
		t.Fatal("破坏已有数据")
	}
}
func TestMissingMappingAndSymlinkFailClosed(t *testing.T) {
	m := manager(t)
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

func TestInterruptedDirectoryCreationResumes(t *testing.T) {
	m := manager(t)
	s := spec()
	if err := PrivateDir(m.root); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(m.root, "volumes"), []byte("block"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Ensure(t.Context(), s); err == nil {
		t.Fatal("目录创建失败仍成功")
	}
	if err := os.Remove(filepath.Join(m.root, "volumes")); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Ensure(t.Context(), s); err != nil {
		t.Fatal(err)
	}
}

func TestUnregisteredDirectoryIsNotAdopted(t *testing.T) {
	m := manager(t)
	s := spec()
	dir := filepath.Join(m.root, "volumes", Key(s.Volumes[0].ID))
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "user-data")
	if err := os.WriteFile(file, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(m.root, "volumes.json"), []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Ensure(t.Context(), s); err == nil {
		t.Fatal("接管了没有绑定的非空目录")
	}
	if data, err := os.ReadFile(file); err != nil || string(data) != "keep" {
		t.Fatal("改变了原始数据")
	}
}
