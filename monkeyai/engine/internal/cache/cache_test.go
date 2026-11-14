package cache

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

type fakeStore struct {
	usage   Usage
	images  []Image
	deleted []string
	gain    int64
	err     error
}

func (s *fakeStore) Usage(context.Context) (Usage, error)    { return s.usage, nil }
func (s *fakeStore) Images(context.Context) ([]Image, error) { return s.images, nil }
func (s *fakeStore) Delete(_ context.Context, i Image) error {
	if s.err != nil {
		return s.err
	}
	s.deleted = append(s.deleted, i.Name)
	s.images = slices.DeleteFunc(s.images, func(v Image) bool { return v.Name == i.Name })
	s.usage.Bytes -= s.gain
	s.usage.FreeBytes += s.gain
	if s.gain > 0 {
		s.usage.FreeInodes += ReserveInodes
	}
	return nil
}
func TestReclaimUsesLRUAndPreservesLiveAndUnknownImages(t *testing.T) {
	c := DefaultConfig()
	now := time.Now()
	s := &fakeStore{usage: Usage{c.MaxBytes - ReserveBytes + 2<<30, 100 << 30, 2000000}, gain: 1 << 30, images: []Image{{Name: "new", Managed: true, UsedAt: now}, {Name: "pinned", Managed: true, Pinned: true}, {Name: "unknown"}, {Name: "old", Managed: true, UsedAt: now.Add(-time.Hour)}}}
	r, err := Reclaim(t.Context(), s, c, true)
	if err != nil || !r.Ready || !slices.Equal(s.deleted, []string{"old", "new"}) || len(r.Images) != 2 {
		t.Fatal(r, s.deleted, err)
	}
}
func TestReclaimChecksDiskAndInodesAndDoesNotAssumeDeletionFreedSpace(t *testing.T) {
	c := DefaultConfig()
	for name, u := range map[string]Usage{"free-space": {0, c.MinFreeBytes + ReserveBytes - 1, 2000000}, "inodes": {0, 100 << 30, c.MinFreeInodes + ReserveInodes - 1}, "cache": {c.MaxBytes - ReserveBytes + 1, 100 << 30, 2000000}} {
		t.Run(name, func(t *testing.T) {
			s := &fakeStore{usage: u, images: []Image{{Name: "shared", Managed: true}}}
			r, err := Reclaim(t.Context(), s, c, true)
			if err == nil || r.Ready || len(s.deleted) != 1 {
				t.Fatal("将未释放的共享数据当成空闲空间", r, err)
			}
		})
	}
	s := &fakeStore{usage: Usage{c.MaxBytes, 100 << 30, 2000000}, images: []Image{{Name: "broken", Managed: true}}, err: errors.New("GC 失败")}
	if _, err := Reclaim(t.Context(), s, c, true); !errors.Is(err, s.err) {
		t.Fatal(err)
	}
}
func TestWarmInspectionAndBoundedConfiguration(t *testing.T) {
	c := DefaultConfig()
	s := &fakeStore{usage: Usage{0, 100 << 30, 2000000}}
	r, err := Inspect(t.Context(), s, c)
	if err != nil || !r.Ready || len(s.deleted) > 0 {
		t.Fatal(r, err)
	}
	for _, bad := range []Config{{}, {MaxBytes: 1 << 30, MinFreeBytes: 8 << 30, MinFreeInodes: 100000}, {MaxBytes: 64 << 30, MinFreeBytes: 1, MinFreeInodes: 100000}} {
		if bad.Validate() == nil {
			t.Fatal("接受无效预算")
		}
	}
	path := filepath.Join(t.TempDir(), "cache.json")
	if got, err := Read(path); err != nil || got != c {
		t.Fatal(got, err)
	}
	for _, raw := range []string{`{"max_bytes":0}`, `{"unknown":true}`, `{} {}`, `null`} {
		os.WriteFile(path, []byte(raw), 0600)
		if _, err := Read(path); err == nil {
			t.Fatal("接受无效配置", raw)
		}
	}
	os.Remove(path)
	os.Symlink("missing", path)
	if _, err := Read(path); err == nil {
		t.Fatal("接受符号链接")
	}
}
