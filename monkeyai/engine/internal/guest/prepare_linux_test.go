//go:build linux

package guest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/runtimeupdate"
)

func TestRuntimePreparationIntegration(t *testing.T) {
	if os.Getenv("MONKEYAI_GUEST_RUNTIME_TEST") != "1" {
		t.Skip("仅在隔离Linux测试容器执行真实runtime准备")
	}
	const source = "/opt/monkeyai/monkeyai-runtime"
	raw, err := exec.CommandContext(t.Context(), source, "bundle-info").Output()
	if err != nil {
		t.Fatal(err)
	}
	var bundle struct {
		Version         string `json:"version"`
		RuntimeRevision string `json:"runtimeRevision"`
		EngineRevision  string `json:"engineRevision"`
	}
	if json.Unmarshal(raw, &bundle) != nil {
		t.Fatal("runtime清单损坏")
	}
	payload, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(payload)
	release := lifecycle.RuntimePackage{Version: bundle.Version, Architecture: runtime.GOARCH, RuntimeRevision: bundle.RuntimeRevision, EngineRevision: bundle.EngineRevision, Files: map[string]lifecycle.RuntimeFile{"monkeyai-runtime": {SHA256: hex.EncodeToString(hash[:]), Size: int64(len(payload))}}}
	root := filepath.Join(t.TempDir(), "runtime")
	if err := os.Mkdir(root, 0755); err != nil {
		t.Fatal(err)
	}
	manager := runtimeupdate.New(root, nil).WithFetcher(func(context.Context, lifecycle.RuntimePackage, string) (io.ReadCloser, error) { return os.Open(source) }).WithPreparer(prepareRuntime)
	if err := manager.Update(t.Context(), release); err != nil {
		t.Fatal(err)
	}
	current, err := manager.Current()
	if err != nil || current.Version != release.Version || current.Binary == "" || current.Engine == "" {
		t.Fatal(current, err)
	}
	if err := manager.Update(t.Context(), release); err != nil {
		t.Fatal("幂等复用失败", err)
	}
}
