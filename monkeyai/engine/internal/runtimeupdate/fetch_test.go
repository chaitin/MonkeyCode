package runtimeupdate

import (
	"bytes"
	"context"
	"io"
	"os"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func TestLocalRuntimeFetcherStillVerifiesBytesBeforeActivation(t *testing.T) {
	root := t.TempDir()
	if err := os.Chmod(root, 0755); err != nil {
		t.Fatal(err)
	}
	release, files := packageFixture("26.1105.1")
	corrupt := true
	manager := New(root, nil).WithFetcher(func(_ context.Context, _ lifecycle.RuntimePackage, name string) (io.ReadCloser, error) {
		raw := files[name]
		if corrupt && name == "monkeyai-runtime" {
			raw = bytes.Repeat([]byte{'x'}, len(raw))
		}
		return io.NopCloser(bytes.NewReader(raw)), nil
	})
	if err := manager.Update(t.Context(), release); err == nil {
		t.Fatal("本地上传未校验摘要")
	}
	if current, err := manager.Current(); err != nil || current.Binary != "" {
		t.Fatal("失败上传激活了runtime", current, err)
	}
	corrupt = false
	if err := manager.Update(t.Context(), release); err != nil {
		t.Fatal(err)
	}
	if current, err := manager.Current(); err != nil || current.Version != release.Version {
		t.Fatal(current, err)
	}
}
