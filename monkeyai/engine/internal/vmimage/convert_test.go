package vmimage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func converterFixture(t *testing.T) (*Converter, Identity, string, string) {
	t.Helper()
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	toolPath := filepath.Join(base, "tool")
	toolData := []byte("#!/bin/sh\nexit 0\n")
	if err := os.WriteFile(toolPath, toolData, 0700); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(base, "guest")
	data := []byte("fixed guest service")
	if err := os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	tool := Tool{Path: toolPath, Digest: digestBytes(toolData)}
	c := &Converter{Unpack: tool, Mkfs: tool, Assets: []Asset{{Target: "opt/monkeyai/guest", Digest: digestBytes(data), Mode: 0755, Source: source}}, Limits: Limits{Bytes: 1 << 20, Files: 100, Timeout: time.Minute}}
	cd, bd, err := c.Identity()
	if err != nil {
		t.Fatal(err)
	}
	layout, manifest, _ := layoutFixture(t, true)
	id := Identity{Architecture: "amd64", ImageDigest: manifest.Digest, ConverterDigest: cd, KernelDigest: cd, BootstrapDigest: bd, SystemBytes: 64 << 20}
	stage := filepath.Join(base, "stage")
	if err := os.Mkdir(stage, 0700); err != nil {
		t.Fatal(err)
	}
	return c, id, layout, stage
}

func fakeUnpack(ctx context.Context, tool Tool, args ...string) error {
	bundle := args[len(args)-1]
	root := filepath.Join(bundle, "rootfs")
	if err := os.MkdirAll(filepath.Join(root, "etc"), 0700); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(root, "etc/machine-id"), []byte("shared identity"), 0600)
}

func TestConverterPipeline(t *testing.T) {
	c, id, layout, stage := converterFixture(t)
	c.run = func(ctx context.Context, tool Tool, args ...string) error {
		if len(args) != 4 || args[0] != "unpack" || args[1] != "--image" || args[2] != filepath.Join(stage, "input")+":root" {
			t.Fatalf("解包命令错误: %v", args)
		}
		if _, err := InspectLayout(ctx, filepath.Join(stage, "input"), id.ImageDigest, id.Architecture, c.Limits.Bytes); err != nil {
			t.Fatal(err)
		}
		return fakeUnpack(ctx, tool, args...)
	}
	c.populate = func(ctx context.Context, disk string, size int64, root string) error {
		data, err := os.ReadFile(filepath.Join(root, "opt/monkeyai/guest"))
		if err != nil || string(data) != "fixed guest service" {
			t.Fatalf("组件未注入: %s %v", data, err)
		}
		if _, err := os.Lstat(filepath.Join(root, "etc/machine-id")); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("共享machine-id未清理")
		}
		f, err := os.OpenFile(disk, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
		if err != nil {
			return err
		}
		return errors.Join(f.Truncate(size), f.Close())
	}
	if err := c.Build(layout)(t.Context(), id, stage); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"input", "bundle"} {
		if _, err := os.Stat(filepath.Join(stage, name)); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("临时产物未清理: %s %v", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(stage, "root.ext4")); err != nil {
		t.Fatal(err)
	}
}

func TestConverterRefusesUnsafeInput(t *testing.T) {
	for _, mode := range []string{"asset-parent-link", "asset-checksum", "identity", "tools", "limits", "files", "devices"} {
		t.Run(mode, func(t *testing.T) {
			c, id, layout, stage := converterFixture(t)
			c.run = func(ctx context.Context, tool Tool, args ...string) error {
				if err := fakeUnpack(ctx, tool, args...); err != nil {
					return err
				}
				root := filepath.Join(stage, "bundle/rootfs")
				if mode == "asset-parent-link" {
					return os.Symlink("/tmp", filepath.Join(root, "opt"))
				}
				if mode == "devices" {
					return os.Symlink("/dev/null", filepath.Join(root, "null"))
				}
				return nil
			}
			called := false
			c.populate = func(context.Context, string, int64, string) error { called = true; return nil }
			switch mode {
			case "asset-checksum":
				if err := os.WriteFile(c.Assets[0].Source, []byte("changed"), 0600); err != nil {
					t.Fatal(err)
				}
			case "identity":
				id.BootstrapDigest = id.ImageDigest
			case "tools":
				if err := os.WriteFile(c.Unpack.Path, []byte("changed"), 0700); err != nil {
					t.Fatal(err)
				}
			case "limits":
				c.Limits.Bytes = 0
			case "files":
				c.Limits.Files = 1
			case "devices":
				// 指向宿主的绝对符号链接允许存在于普通系统文件，但不能作为平台注入父路径。
				c.run = func(ctx context.Context, tool Tool, args ...string) error {
					return errors.New("unpack rejected unsafe special file")
				}
			}
			if err := c.Build(layout)(t.Context(), id, stage); err == nil || called {
				t.Fatalf("不安全输入进入格式化: %v called=%v", err, called)
			}
		})
	}
}

func TestBootstrapIdentityStableAcrossSourcePaths(t *testing.T) {
	c, _, _, _ := converterFixture(t)
	converter, bootstrap, err := c.Identity()
	if err != nil {
		t.Fatal(err)
	}
	c.Assets[0].Source = "/other/installation/path"
	a, b, err := c.Identity()
	if err != nil || a != converter || b != bootstrap {
		t.Fatal("源安装路径不应影响模板身份")
	}
	c.Assets = append(c.Assets, c.Assets[0])
	if _, _, err := c.Identity(); err == nil {
		t.Fatal("重复注入路径被接受")
	}
}
