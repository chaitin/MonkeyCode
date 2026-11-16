package vmimage

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
)

func registryFixture(t *testing.T, mode string) (*Registry, string, string) {
	t.Helper()
	layout, manifest, _ := layoutFixture(t, true)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		username, password, ok := r.BasicAuth()
		if !ok || username != "host-1" || password == "" {
			t.Error("缺少宿主签名凭据")
			w.WriteHeader(401)
			return
		}
		if mode == "redirect" {
			http.Redirect(w, r, "http://127.0.0.1:1/forbidden", 302)
			return
		}
		if mode == "not-ready" {
			w.WriteHeader(503)
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/v2/environments/dev/") {
			t.Error("凭据被发送到错误仓库", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		parts := strings.Split(r.URL.Path, "/")
		digest := parts[len(parts)-1]
		path := filepath.Join(layout, "blobs", "sha256", strings.TrimPrefix(digest, "sha256:"))
		raw, err := os.ReadFile(path)
		if err != nil {
			w.WriteHeader(404)
			return
		}
		if mode == "tamper" && strings.Contains(r.URL.Path, "/blobs/") {
			raw = append([]byte(nil), raw...)
			raw[0] ^= 1
		}
		w.Write(raw)
	}))
	t.Cleanup(server.Close)
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	client, err := control.New(server.URL, key)
	if err != nil {
		t.Fatal(err)
	}
	registry, err := NewRegistry(client, "host-1")
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(server.URL)
	return registry, u.Host + "/environments/dev@" + manifest.Digest, manifest.Digest
}
func TestRegistryPullFromCurrentCenterOnly(t *testing.T) {
	registry, reference, want := registryFixture(t, "")
	destination := filepath.Join(t.TempDir(), "oci")
	image, err := registry.Pull(context.Background(), reference, "amd64", 1<<20, destination)
	if err != nil {
		t.Fatal(err)
	}
	if image.Manifest.Digest != want {
		t.Fatal(image.Manifest)
	}
	if _, err := registry.Pull(context.Background(), reference, "amd64", 1<<20, destination); !errors.Is(err, os.ErrExist) {
		t.Fatal("重复下载覆盖缓存", err)
	}
	if _, err := registry.Pull(context.Background(), "example.com/environments/dev@"+want, "amd64", 1<<20, filepath.Join(t.TempDir(), "other")); err == nil {
		t.Fatal("允许回源其他仓库")
	}
}
func TestRegistryFailuresDoNotPublish(t *testing.T) {
	for _, mode := range []string{"redirect", "not-ready", "tamper"} {
		t.Run(mode, func(t *testing.T) {
			registry, reference, _ := registryFixture(t, mode)
			destination := filepath.Join(t.TempDir(), "oci")
			if _, err := registry.Pull(t.Context(), reference, "amd64", 1<<20, destination); err == nil {
				t.Fatal("接受未校验的镜像")
			}
			if _, err := os.Stat(destination); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("留下未完成目录", err)
			}
		})
	}
}
func TestRegistryRejectsNonCanonicalReferences(t *testing.T) {
	registry, reference, digest := registryFixture(t, "")
	host, _, _ := strings.Cut(reference, "/")
	for _, repo := range []string{"public/dev", "environments/../dev", "environments//dev", "environments/dev:latest", "environments/dev?leak=1"} {
		if _, err := registry.Pull(t.Context(), host+"/"+repo+"@"+digest, "amd64", 1<<20, filepath.Join(t.TempDir(), "oci")); err == nil {
			t.Fatal("非规范仓库被接受", repo)
		}
	}
}
