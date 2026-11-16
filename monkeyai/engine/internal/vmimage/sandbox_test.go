package vmimage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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
