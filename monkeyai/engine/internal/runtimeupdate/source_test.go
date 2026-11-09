package runtimeupdate

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func officialPackageFixture(version string) (lifecycle.RuntimePackage, map[string][]byte) {
	release, files := packageFixture(version)
	release.RuntimeRevision = strings.Repeat("a", 40)
	release.EngineRevision = strings.Repeat("b", 40)
	var bundle map[string]any
	_ = json.Unmarshal(files["bundle.json"], &bundle)
	bundle["runtimeRevision"] = release.RuntimeRevision
	bundle["engineRevision"] = release.EngineRevision
	bundle["licenseSha256"] = release.Files["LICENSES.txt"].SHA256
	files["bundle.json"], _ = json.Marshal(bundle)
	hash := sha256.Sum256(files["bundle.json"])
	release.Files["bundle.json"] = lifecycle.RuntimeFile{SHA256: hex.EncodeToString(hash[:]), Size: int64(len(files["bundle.json"]))}
	return release, files
}
func TestOfficialSingleFileUpdateAndCachedRollback(t *testing.T) {
	full, files := officialPackageFixture("26.1105.2")
	raw := full
	raw.Files = map[string]lifecycle.RuntimeFile{"monkeyai-runtime": full.Files["monkeyai-runtime"]}
	var requests atomic.Int64
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if !strings.HasSuffix(r.URL.Path, "/monkeyai-runtime") {
			t.Error("原始发行不应下载拆分文件", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		w.Write(files["monkeyai-runtime"])
	}))
	defer server.Close()
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	client, _ := control.New(server.URL, key)
	client.WithInsecure(true)
	root := t.TempDir()
	_ = os.Chmod(root, 0755)
	calls := 0
	manager := New(root, client).WithPreparer(func(ctx context.Context, payload, destination string, wanted lifecycle.RuntimePackage, reuse []string) (lifecycle.RuntimePackage, error) {
		calls++
		if wanted.Version != raw.Version || payload != filepath.Join(destination, "monkeyai-runtime") {
			return wanted, errors.New("准备参数无效")
		}
		for _, name := range []string{"ohmyagent", "bundle.json", "LICENSES.txt"} {
			mode := os.FileMode(0644)
			if name == "ohmyagent" {
				mode = 0755
			}
			if err := os.WriteFile(filepath.Join(destination, name), files[name], mode); err != nil {
				return wanted, err
			}
		}
		return full, nil
	})
	if err := manager.Update(t.Context(), raw); err != nil {
		t.Fatal(err)
	}
	current, err := manager.Current()
	if err != nil || current.Version != raw.Version || calls != 1 || requests.Load() != 1 {
		t.Fatal(current, err, calls, requests.Load())
	}
	if err := New(root, client).Update(t.Context(), raw); err != nil {
		t.Fatal("缓存版本不应依赖准备器或网络", err)
	}
	if calls != 1 || requests.Load() != 1 {
		t.Fatal("重复准备或下载")
	}
	next := raw
	next.Version = "26.1105.3"
	manager.WithPreparer(func(context.Context, string, string, lifecycle.RuntimePackage, []string) (lifecycle.RuntimePackage, error) {
		return lifecycle.RuntimePackage{}, errors.New("模拟释放失败")
	})
	if err := manager.Update(t.Context(), next); err == nil {
		t.Fatal("释放失败仍然切换")
	}
	current, err = manager.Current()
	if err != nil || current.Version != raw.Version {
		t.Fatal("失败破坏了旧版本", current, err)
	}
}
func TestOfficialSourceAdoptsMatchingLegacyCache(t *testing.T) {
	full, files := officialPackageFixture("26.1105.2")
	raw := full
	raw.Files = map[string]lifecycle.RuntimeFile{"monkeyai-runtime": full.Files["monkeyai-runtime"]}
	legacy := full
	legacy.RuntimeRevision = ""
	legacy.EngineRevision = ""
	var requests atomic.Int64
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		parts := strings.Split(r.URL.Path, "/")
		w.Write(files[parts[len(parts)-1]])
	}))
	defer server.Close()
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	client, _ := control.New(server.URL, key)
	client.WithInsecure(true)
	root := t.TempDir()
	_ = os.Chmod(root, 0755)
	manager := New(root, client)
	if err := manager.Update(t.Context(), legacy); err != nil {
		t.Fatal(err)
	}
	before := requests.Load()
	if err := manager.Update(t.Context(), raw); err != nil {
		t.Fatal("不能认领匹配的旧缓存", err)
	}
	if requests.Load() != before {
		t.Fatal("认领已验证缓存时仍访问了网络")
	}
	wrong := raw
	wrong.EngineRevision = strings.Repeat("c", 40)
	if err := manager.Update(t.Context(), wrong); err == nil {
		t.Fatal("相同版本接受了不同修订")
	}
}
