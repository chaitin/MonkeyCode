package envimage

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/empty"
	"github.com/google/go-containerregistry/pkg/v1/layout"
	"github.com/google/go-containerregistry/pkg/v1/mutate"
	"github.com/google/go-containerregistry/pkg/v1/random"
	"github.com/google/go-containerregistry/pkg/v1/remote"
)

func testIndex(t *testing.T) v1.ImageIndex {
	t.Helper()
	var index v1.ImageIndex = empty.Index
	for _, arch := range []string{"amd64", "arm64"} {
		image, err := random.Image(1024, 1)
		if err != nil {
			t.Fatal(err)
		}
		config, err := image.ConfigFile()
		if err != nil {
			t.Fatal(err)
		}
		config.OS, config.Architecture = "linux", arch
		image, err = mutate.ConfigFile(image, config)
		if err != nil {
			t.Fatal(err)
		}
		index = mutate.AppendManifests(index, mutate.IndexAddendum{Add: image, Descriptor: v1.Descriptor{Platform: &v1.Platform{OS: "linux", Architecture: arch}}})
	}
	return index
}
func TestRegistryPreservesBothArchitecturesAndRequiresHostAccess(t *testing.T) {
	service, err := New(t.Context(), t.TempDir(), "https://registry.example")
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	service.WithAuthorize(func(r *http.Request) bool {
		user, password, ok := r.BasicAuth()
		return ok && user == "host" && password == "valid"
	})
	server := httptest.NewTLSServer(service)
	defer server.Close()
	service.host = strings.TrimPrefix(server.URL, "https://")
	index := testIndex(t)
	digest, _ := index.Digest()
	source := "upstream.invalid/environment@" + digest.String()
	if err := service.pushIndex(t.Context(), source, index); err != nil {
		t.Fatal(err)
	}
	ref, err := service.Resolve(t.Context(), source, "arm64")
	if err != nil {
		t.Fatal(err)
	}
	destination, err := name.NewDigest(ref)
	if err != nil {
		t.Fatal(err)
	}
	pulled, err := remote.Index(destination, remote.WithContext(t.Context()), remote.WithTransport(server.Client().Transport), remote.WithAuth(&authn.Basic{Username: "host", Password: "valid"}))
	if err != nil {
		t.Fatal(err)
	}
	actual, _ := pulled.Digest()
	if actual != digest {
		t.Fatal("仓库改变了索引摘要", actual, digest)
	}
	manifest, _ := pulled.IndexManifest()
	if len(manifest.Manifests) != 2 {
		t.Fatal(manifest)
	}
	for _, item := range manifest.Manifests {
		image, err := pulled.Image(item.Digest)
		if err != nil {
			t.Fatal(err)
		}
		config, err := image.ConfigFile()
		if err != nil || config.Architecture != item.Platform.Architecture {
			t.Fatal(config, err)
		}
		layers, err := image.Layers()
		if err != nil {
			t.Fatal(err)
		}
		stream, err := layers[0].Compressed()
		if err != nil {
			t.Fatal(err)
		}
		_, err = io.Copy(io.Discard, stream)
		stream.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	response, err := server.Client().Get(server.URL + "/v2/")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatal(response.StatusCode)
	}
	request, _ := http.NewRequest(http.MethodPut, server.URL+"/v2/"+Repository(source)+"/manifests/change", nil)
	request.SetBasicAuth("host", "valid")
	response, err = server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusMethodNotAllowed {
		t.Fatal("公开仓库允许写入", response.StatusCode)
	}
}
func TestOCIImportNeedsNoUpstream(t *testing.T) {
	service, err := New(t.Context(), t.TempDir(), "https://registry.example")
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	index := testIndex(t)
	digest, _ := index.Digest()
	reference := "unreachable.invalid/environment@" + digest.String()
	root := t.TempDir()
	path, err := layout.Write(filepath.Join(root, Key(reference)), empty.Index)
	if err != nil {
		t.Fatal(err)
	}
	if err := path.AppendIndex(index); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal([]string{reference})
	if err := os.WriteFile(filepath.Join(root, "catalog.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err := service.Import(t.Context(), root); err != nil {
		t.Fatal(err)
	}
	for _, arch := range []string{"amd64", "arm64"} {
		expected, err := service.Resolve(t.Context(), reference, arch)
		if err != nil {
			t.Fatal(arch, err)
		}
		if current, actual, err := service.Default(t.Context(), arch); err != nil || strings.Contains(current, "@") || actual != digest.String() || current == expected {
			t.Fatal("未使用server默认镜像的版本标签与独立摘要", arch, current, actual, err)
		}
	}
	if _, err := service.Resolve(t.Context(), reference, "riscv64"); err == nil {
		t.Fatal("接受未准备的架构")
	}
	if _, err := service.Resolve(t.Context(), "upstream.invalid/unprepared@"+digest.String(), "amd64"); err == nil {
		t.Fatal("允许缺失资源直接回源")
	}
}
