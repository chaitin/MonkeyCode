package runtimeartifact

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment"
	"github.com/go-chi/chi/v5"
)

func TestRuntimeArtifactsAreVersionedAndWhitelisted(t *testing.T) {
	root := t.TempDir()
	folder := filepath.Join(root, "26.1105.2", "arm64")
	if err := os.MkdirAll(folder, 0755); err != nil {
		t.Fatal(err)
	}
	release := environment.RuntimePackage{Version: "26.1105.2", Architecture: "arm64", Files: map[string]environment.RuntimeFile{}}
	for _, name := range []string{"monkeyai-runtime", "ohmyagent", "LICENSES.txt", "bundle.json"} {
		if err := os.WriteFile(filepath.Join(folder, name), []byte("fixture"), 0644); err != nil {
			t.Fatal(err)
		}
		release.Files[name] = environment.RuntimeFile{SHA256: strings.Repeat("a", 64), Size: 7}
	}
	raw, _ := json.Marshal(release)
	if err := os.WriteFile(filepath.Join(folder, "manifest.json"), raw, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "latest.json"), []byte(`{"version":"26.1105.2"}`), 0644); err != nil {
		t.Fatal(err)
	}
	service := New(root, "")
	current, err := service.Current("arm64")
	if err != nil || current.Version != "26.1105.2" {
		t.Fatal(current, err)
	}
	router := chi.NewRouter()
	service.RegisterHost(router)
	for _, name := range []string{"monkeyai-runtime", "ohmyagent", "LICENSES.txt", "bundle.json", "manifest.json"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", "/api/host/v1/runtime-releases/26.1105.2/arm64/"+name, nil))
		if response.Code != 200 || response.Body.Len() == 0 || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(name, response.Code)
		}
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/api/host/v1/runtime-releases/26.1105.2/arm64/identity.key", nil))
	if response.Code != 404 {
		t.Fatal("提供了非发行文件", response.Code)
	}
	if _, err := service.Get("../escape", "arm64"); err == nil {
		t.Fatal("允许逃逸版本目录")
	}
	if err := os.Remove(filepath.Join(folder, "ohmyagent")); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Current("arm64"); err == nil {
		t.Fatal("资源不完整仍返回可更新版本")
	}
	release.Files = map[string]environment.RuntimeFile{"monkeyai-runtime": release.Files["monkeyai-runtime"]}
	release.RuntimeRevision = strings.Repeat("a", 40)
	release.EngineRevision = strings.Repeat("b", 40)
	raw, _ = json.Marshal(release)
	if err := os.WriteFile(filepath.Join(folder, "manifest.json"), raw, 0644); err != nil {
		t.Fatal(err)
	}
	if current, err := service.Current("arm64"); err != nil || !current.SingleFile() {
		t.Fatal("官方单文件必须无需预释放引擎即可提供", current, err)
	}
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("GET", "/api/host/v1/runtime-releases/26.1105.2/arm64/ohmyagent", nil))
	if response.Code != 404 {
		t.Fatal("原始发行不应提供未在清单中锁定的引擎文件", response.Code)
	}
}
