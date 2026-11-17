package vmimage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSandboxExecutableIsIndependentAndSearchable(t *testing.T) {
	root := t.TempDir()
	source, destination := filepath.Join(root, "installed-engine"), filepath.Join(root, "sandbox-engine")
	if err := os.WriteFile(source, []byte("fixed executable"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := copyExecutable(t.Context(), source, destination); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(source)
	if err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(destination)
	if err != nil {
		t.Fatal(err)
	}
	if before.Mode().Perm() != 0700 || after.Mode().Perm() != 0555 || os.SameFile(before, after) {
		t.Fatal("隔离执行权限不正确，或副本修改了宿主源文件权限", before.Mode(), after.Mode())
	}
	data, err := os.ReadFile(destination)
	if err != nil || string(data) != "fixed executable" {
		t.Fatal("固定程序内容变化", string(data), err)
	}
	if err := copyExecutable(context.Background(), source, destination); err == nil {
		t.Fatal("覆盖了既有隔离程序")
	}
}

func TestCachePreservesUnconfirmedWriterAndRejectsNewBuild(t *testing.T) {
	cache, id := testCache(t), testIdentity()
	builds := 0
	_, err := cache.Ensure(t.Context(), id, func(_ context.Context, _ Identity, stage string) error {
		builds++
		if err := saveConversionJob(stage, "ma-cvt-aaaaaaaaaaaaaaaaaaaaaaaa.service"); err != nil {
			return err
		}
		return ErrConversionCleanup
	})
	if !errors.Is(err, ErrConversionCleanup) {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(cache.root, "templates"))
	if err != nil {
		t.Fatal(err)
	}
	retained := false
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".convert-") {
			retained = true
		}
	}
	if !retained {
		t.Fatal("未确认退出的转换进程暂存目录被删除")
	}
	_, err = cache.Ensure(t.Context(), id, func(_ context.Context, _ Identity, _ string) error { builds++; return nil })
	if err == nil || builds != 1 {
		t.Fatal("同预算重复启动中断的转换", builds, err)
	}
}
