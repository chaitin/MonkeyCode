package driver

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockerapi"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

func TestOfficialRuntimeExtractionDockerIntegration(t *testing.T) {
	image, resources := os.Getenv("MONKEYAI_PERSISTENCE_TEST_IMAGE"), os.Getenv("MONKEYAI_RUNTIME_TEST_RESOURCES")
	if image == "" || resources == "" {
		t.Skip("需要一次性Docker和官方单文件资源")
	}
	if _, err := os.Stat("/monkeyai-docker-test"); err != nil {
		t.Fatal("缺少隔离测试标记")
	}
	folder := filepath.Join(resources, "26.1105.2", runtime.GOARCH)
	raw, err := os.ReadFile(filepath.Join(folder, "manifest.json"))
	var release lifecycle.RuntimePackage
	if err != nil || json.Unmarshal(raw, &release) != nil || release.Validate() != nil || !release.SingleFile() {
		t.Fatal("需要官方单文件清单", err)
	}
	root := t.TempDir()
	socket := filepath.Join(root, "api.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", dockerapi.Socket)
	}}
	defer transport.CloseIdleConnections()
	proxy := httputil.NewSingleHostReverseProxy(&url.URL{Scheme: "http", Host: "docker"})
	proxy.Transport = transport
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" && r.URL.Query().Get("path") == "/opt/monkeyai/ohmyagent" {
			http.NotFound(w, r)
			return
		}
		proxy.ServeHTTP(w, r)
	})}
	go server.Serve(listener)
	defer server.Close()
	volumes, err := storage.New(filepath.Join(root, "data"))
	if err != nil {
		t.Fatal(err)
	}
	driver, err := New(dockerapi.Socket, filepath.Join(root, "instances"), volumes)
	if err != nil {
		t.Fatal(err)
	}
	driver.client.Close()
	driver.client = dockerapi.New(socket)
	defer driver.Close()
	spec := sample()
	spec.EnvironmentID = "official-extraction"
	spec.Image, spec.ImageDigest = image, image[len(image)-71:]
	if err := driver.Prepare(t.Context(), spec); err != nil {
		t.Fatal(err)
	}
	prepared, err := driver.PrepareRuntime(t.Context(), spec, filepath.Join(folder, "monkeyai-runtime"), t.TempDir(), release, nil)
	if err != nil || prepared.Validate() != nil || prepared.SingleFile() || len(prepared.Files) != 4 {
		t.Fatal("真实内嵌引擎释放失败", prepared, err)
	}
	t.Log("真实原生gVisor隔离释放OhMyAgent、版本/修订/文件摘要与临时容器清理通过", runtime.GOARCH)
}
