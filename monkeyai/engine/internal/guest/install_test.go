package guest

import (
	"archive/tar"
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
)

type installBackend struct {
	installed bool
	root      string
	failure   error
}

func (b *installBackend) Install(ctx context.Context, r lifecycle.RuntimePackage, input io.Reader) error {
	err := receiveRuntime(ctx, b.root, r, input)
	b.installed = err == nil && b.failure == nil
	return errors.Join(err, b.failure)
}
func (*installBackend) Status(context.Context) (standalone.Status, error) {
	return standalone.Status{}, nil
}
func (*installBackend) Login(context.Context, lifecycle.Runtime, func(string) error) error {
	return nil
}
func (*installBackend) Serve(context.Context, bool) error { return nil }
func (*installBackend) Shutdown(context.Context) error    { return nil }
func runtimeRelease() lifecycle.RuntimePackage {
	return lifecycle.RuntimePackage{Version: "26.1.1", Architecture: "amd64", RuntimeRevision: strings.Repeat("a", 40), EngineRevision: strings.Repeat("b", 40), Files: map[string]lifecycle.RuntimeFile{"monkeyai-runtime": {SHA256: strings.Repeat("c", 64), Size: 4}}}
}
func TestRuntimeTransportUsesBoundIdentityAndFixedFiles(t *testing.T) {
	binding := Binding{EnvironmentID: "env", InstanceID: "instance", BootID: "boot"}
	backend := &installBackend{root: t.TempDir()}
	service, err := NewService(binding, backend)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(service)
	defer server.Close()
	client, err := NewClient(binding, func(ctx context.Context) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
	})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	err = client.Install(t.Context(), runtimeRelease(), func(string) (io.ReadCloser, error) { return io.NopCloser(strings.NewReader("test")), nil })
	if err != nil || !backend.installed {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(backend.root, "monkeyai-runtime"))
	if err != nil || string(data) != "test" {
		t.Fatal(string(data), err)
	}
	wrong, err := NewClient(Binding{EnvironmentID: "other", InstanceID: "instance", BootID: "boot"}, func(ctx context.Context) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
	})
	if err != nil {
		t.Fatal(err)
	}
	defer wrong.Close()
	if err := wrong.Install(t.Context(), runtimeRelease(), func(string) (io.ReadCloser, error) { return io.NopCloser(strings.NewReader("test")), nil }); err == nil {
		t.Fatal("其他环境管理身份被接受")
	}
}
func TestRuntimeInstallReturnsBoundedFailureDetails(t *testing.T) {
	for _, detail := range []string{"runtime准备失败", strings.Repeat("x", 10000)} {
		binding := Binding{EnvironmentID: "env", InstanceID: "instance", BootID: "boot"}
		service, err := NewService(binding, &installBackend{root: t.TempDir(), failure: errors.New(detail)})
		if err != nil {
			t.Fatal(err)
		}
		server := httptest.NewServer(service)
		client, err := NewClient(binding, func(ctx context.Context) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
		})
		if err != nil {
			server.Close()
			t.Fatal(err)
		}
		err = client.Install(t.Context(), runtimeRelease(), func(string) (io.ReadCloser, error) { return io.NopCloser(strings.NewReader("test")), nil })
		client.Close()
		server.Close()
		if err == nil || !strings.Contains(err.Error(), "状态码409") || len(err.Error()) > 4500 {
			t.Fatal("失败详情缺失或未限长", err)
		}
		if len(detail) < 4096 && !strings.Contains(err.Error(), detail) {
			t.Fatal("原始失败详情被丢弃", err)
		}
	}
}

func TestRuntimeUploadRejectsUnsafeEntries(t *testing.T) {
	for _, header := range []tar.Header{{Name: "../escape", Typeflag: tar.TypeReg, Size: 4}, {Name: "monkeyai-runtime", Typeflag: tar.TypeSymlink, Linkname: "/etc/passwd"}, {Name: "monkeyai-runtime", Typeflag: tar.TypeReg, Size: 3}} {
		var data bytes.Buffer
		tw := tar.NewWriter(&data)
		if err := tw.WriteHeader(&header); err != nil {
			t.Fatal(err)
		}
		if header.Size > 0 {
			tw.Write(make([]byte, header.Size))
		}
		tw.Close()
		if err := receiveRuntime(t.Context(), t.TempDir(), runtimeRelease(), &data); err == nil {
			t.Fatal("接受不安全条目", header)
		}
	}
	r := httptest.NewRequest(http.MethodPost, "/v1/runtime", strings.NewReader(""))
	service, _ := NewService(Binding{EnvironmentID: "env", InstanceID: "instance", BootID: "boot"}, &installBackend{})
	w := httptest.NewRecorder()
	service.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("缺少上传身份仍被接受", w.Code)
	}
}
