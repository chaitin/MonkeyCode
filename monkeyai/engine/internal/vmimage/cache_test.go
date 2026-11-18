package vmimage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testIdentity() Identity {
	d := "sha256:" + strings.Repeat("a", 64)
	return Identity{Architecture: "amd64", ImageDigest: d, ConverterDigest: d, KernelDigest: d, BootstrapDigest: d, DiskBytes: 64 << 20}
}

func testCache(t *testing.T) *Cache {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	c, err := New(filepath.Join(root, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func buildDisk(ctx context.Context, identity Identity, dir string) error {
	f, err := os.OpenFile(filepath.Join(dir, "root.ext4"), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Truncate(identity.DiskBytes)
}

func TestIdentity(t *testing.T) {
	id := testIdentity()
	key, err := id.Key()
	if err != nil {
		t.Fatal(err)
	}
	if len(key) != 64 {
		t.Fatalf("key: %q", key)
	}
	for _, change := range []func(*Identity){
		func(i *Identity) { i.Architecture = "arm64" },
		func(i *Identity) { i.KernelDigest = "sha256:" + strings.Repeat("b", 64) },
		func(i *Identity) { i.BootstrapDigest = "sha256:" + strings.Repeat("b", 64) },
		func(i *Identity) { i.ConverterDigest = "sha256:" + strings.Repeat("b", 64) },
		func(i *Identity) { i.ImageDigest = "sha256:" + strings.Repeat("b", 64) },
		func(i *Identity) { i.DiskBytes += 4096 },
	} {
		copy := id
		change(&copy)
		next, err := copy.Key()
		if err != nil || next == key {
			t.Fatalf("缓存身份未区分: %+v %v", copy, err)
		}
	}
	for _, change := range []func(*Identity){
		func(i *Identity) { i.Architecture = "x86_64" },
		func(i *Identity) { i.ImageDigest = "latest" },
		func(i *Identity) { i.KernelDigest = "sha256:" + strings.Repeat("A", 64) },
		func(i *Identity) { i.DiskBytes = 1 },
	} {
		copy := id
		change(&copy)
		if _, err := copy.Key(); err == nil {
			t.Fatalf("接受非法身份: %+v", copy)
		}
	}
}

func TestCacheReuse(t *testing.T) {
	c := testCache(t)
	id := testIdentity()
	count := 0
	build := func(ctx context.Context, i Identity, dir string) error { count++; return buildDisk(ctx, i, dir) }
	first, err := c.Ensure(context.Background(), id, build)
	if err != nil {
		t.Fatal(err)
	}
	second, err := c.Ensure(context.Background(), id, build)
	if err != nil {
		t.Fatal(err)
	}
	if first != second || count != 1 {
		t.Fatalf("缓存未复用: %+v %+v %d", first, second, count)
	}
	info, err := os.Stat(first.Path)
	if err != nil || info.Mode().Perm() != 0400 {
		t.Fatalf("模板权限错误: %v %v", info, err)
	}
}

func TestCacheFailureDoesNotPublish(t *testing.T) {
	for _, mode := range []string{"build", "missing", "size", "symlink", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			c := testCache(t)
			id := testIdentity()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			_, err := c.Ensure(ctx, id, func(ctx context.Context, i Identity, dir string) error {
				switch mode {
				case "build":
					return errors.New("转换失败")
				case "missing":
					return nil
				case "size":
					return os.WriteFile(filepath.Join(dir, "root.ext4"), []byte("short"), 0600)
				case "symlink":
					return os.Symlink("/dev/null", filepath.Join(dir, "root.ext4"))
				default:
					if err := buildDisk(ctx, i, dir); err != nil {
						return err
					}
					cancel()
					return nil
				}
			})
			if err == nil {
				t.Fatal("应拒绝失败构建")
			}
			if _, err := c.Ensure(context.Background(), id, buildDisk); err != nil {
				t.Fatalf("失败后不能重新构建: %v", err)
			}
		})
	}
}

func TestCacheTamperFailsClosed(t *testing.T) {
	for _, mode := range []string{"content", "writable", "truncate", "manifest", "missing"} {
		t.Run(mode, func(t *testing.T) {
			c := testCache(t)
			id := testIdentity()
			template, err := c.Ensure(context.Background(), id, buildDisk)
			if err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "content", "truncate":
				if err := os.Chmod(template.Path, 0600); err != nil {
					t.Fatal(err)
				}
				f, err := os.OpenFile(template.Path, os.O_WRONLY, 0)
				if err != nil {
					t.Fatal(err)
				}
				if mode == "content" {
					_, err = f.WriteAt([]byte("tamper"), 0)
				} else {
					err = f.Truncate(4096)
				}
				if err != nil {
					t.Fatal(err)
				}
				if err := f.Close(); err != nil {
					t.Fatal(err)
				}
				if err := os.Chmod(template.Path, 0400); err != nil {
					t.Fatal(err)
				}
			case "writable":
				err = os.Chmod(template.Path, 0600)
			case "manifest":
				err = os.WriteFile(filepath.Join(filepath.Dir(template.Path), "manifest.json"), []byte("{}"), 0600)
			case "missing":
				err = os.Remove(template.Path)
			}
			if err != nil {
				t.Fatal(err)
			}
			called := false
			_, err = c.Ensure(context.Background(), id, func(context.Context, Identity, string) error { called = true; return nil })
			if err == nil || called {
				t.Fatalf("损坏缓存被覆盖: %v called=%v", err, called)
			}
		})
	}
}
