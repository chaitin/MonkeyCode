package enginehost

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestFirecrackerArchiveRoute(t *testing.T) {
	dir := fixture(t)
	s := NewService(nil).WithInstallation("https://control.example", dir, "v1")
	router := chi.NewRouter()
	s.Register(router)
	route := "/api/host/v1/releases/v1/amd64/firecracker.tgz"
	if w := call(router, "GET", route, nil); w.Code != 404 {
		t.Fatal("未声明Firecracker依赖却提供下载")
	}
	path := filepath.Join(dir, "v1", "amd64", "manifest.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	m["firecracker"] = map[string]any{"version": 1, "archive_sha256": strings.Repeat("a", 64)}
	raw, _ = json.Marshal(m)
	if err := os.WriteFile(path, raw, 0644); err != nil {
		t.Fatal(err)
	}
	if w := call(router, "GET", route, nil); w.Code != 404 {
		t.Fatal("缺失Firecracker归档却成功")
	}
	archive := filepath.Join(dir, "v1", "amd64", "firecracker.tgz")
	if err := os.WriteFile(archive, []byte("vm-archive"), 0644); err != nil {
		t.Fatal(err)
	}
	if w := call(router, "GET", route, nil); w.Code != 200 || w.Body.String() != "vm-archive" {
		t.Fatal(w.Code, w.Body.String())
	}
	if err := os.Remove(archive); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, "v1", "amd64", "runsc"), archive); err != nil {
		t.Fatal(err)
	}
	if w := call(router, "GET", route, nil); w.Code != 404 {
		t.Fatal("接受归档符号链接")
	}
}
