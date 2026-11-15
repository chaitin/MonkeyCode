package envimage

import (
	"encoding/json"
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
	"github.com/google/go-containerregistry/pkg/v1/mutate"
	"github.com/google/go-containerregistry/pkg/v1/remote"
)

func versionedIndex(t *testing.T, version string) v1.ImageIndex {
	t.Helper()
	original := testIndex(t)
	manifest, err := original.IndexManifest()
	if err != nil {
		t.Fatal(err)
	}
	var result v1.ImageIndex = empty.Index
	for _, item := range manifest.Manifests {
		image, err := original.Image(item.Digest)
		if err != nil {
			t.Fatal(err)
		}
		config, err := image.ConfigFile()
		if err != nil {
			t.Fatal(err)
		}
		config.Config.Labels = map[string]string{"org.opencontainers.image.version": version}
		image, err = mutate.ConfigFile(image, config)
		if err != nil {
			t.Fatal(err)
		}
		result = mutate.AppendManifests(result, mutate.IndexAddendum{Add: image, Descriptor: v1.Descriptor{Platform: item.Platform}})
	}
	return result
}
func TestReadableVersionTagAndImmutableContent(t *testing.T) {
	root := t.TempDir()
	service, err := New(t.Context(), root, "https://registry.example")
	if err != nil {
		t.Fatal(err)
	}
	service.WithAuthorize(func(*http.Request) bool { return true })
	server := httptest.NewTLSServer(service)
	service.host = strings.TrimPrefix(server.URL, "https://")
	index := versionedIndex(t, "runtime-26.1105.2-v26110501")
	digest, _ := index.Digest()
	reference := "upstream.invalid/project/monkeyai-environment@" + digest.String()
	if err := service.pushIndex(t.Context(), reference, index); err != nil {
		t.Fatal(err)
	}
	if err := service.selectDefault(reference); err != nil {
		t.Fatal(err)
	}
	current, expected, err := service.Default(t.Context(), "arm64")
	if err != nil || expected != digest.String() || current != service.host+"/environments/monkeyai-environment:runtime-26.1105.2-v26110501" || strings.Contains(current, "@sha256") {
		t.Fatal(current, expected, err)
	}
	target, err := name.NewTag(current, name.StrictValidation)
	if err != nil {
		t.Fatal(err)
	}
	pulled, err := remote.Index(target, remote.WithContext(t.Context()), remote.WithTransport(server.Client().Transport), remote.WithAuth(authn.Anonymous))
	if err != nil {
		t.Fatal(err)
	}
	actual, err := pulled.Digest()
	if err != nil || actual != digest {
		t.Fatal("可读标签改变了多架构索引", actual, err)
	}
	changed := versionedIndex(t, "runtime-26.1105.2-v26110501")
	other, _ := changed.Digest()
	if err := service.pushIndex(t.Context(), "upstream.invalid/project/monkeyai-environment@"+other.String(), changed); err == nil {
		t.Fatal("同版本不同内容覆盖了已发布标签")
	}
	server.Close()
	service.Close()
	restored, err := New(t.Context(), root, "https://registry.example")
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	current, expected, err = restored.Default(t.Context(), "amd64")
	if err != nil || expected != digest.String() || current != "registry.example/environments/monkeyai-environment:runtime-26.1105.2-v26110501" {
		t.Fatal("重启未恢复默认版本", current, expected, err)
	}
}
func TestLegacyCatalogAndDigestPathRemainAvailable(t *testing.T) {
	root := t.TempDir()
	service, err := New(t.Context(), root, "https://registry.example")
	if err != nil {
		t.Fatal(err)
	}
	index := versionedIndex(t, "v20261106")
	digest, _ := index.Digest()
	reference := "upstream.invalid/dev@" + digest.String()
	legacy, err := service.target(reference)
	if err != nil {
		t.Fatal(err)
	}
	if err := remote.WriteIndex(legacy, index, remote.WithContext(t.Context()), remote.WithTransport(service.transport)); err != nil {
		t.Fatal(err)
	}
	old := map[string]Image{reference: {Source: reference, Reference: "registry.example/" + Repository(reference) + "@" + digest.String(), Status: "ready", Architectures: []string{"amd64", "arm64"}}}
	raw, _ := json.Marshal(old)
	if err := os.WriteFile(filepath.Join(root, "catalog.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	service.Close()
	service, err = New(t.Context(), root, "https://registry.example")
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	if err := service.pushIndex(t.Context(), reference, index); err != nil {
		t.Fatal(err)
	}
	if err := service.selectDefault(reference); err != nil {
		t.Fatal(err)
	}
	oldReference := old[reference].Reference
	if resolved, err := service.Resolve(t.Context(), oldReference, "arm64"); err != nil || resolved != oldReference {
		t.Fatal("历史环境的摘要快照无法继续使用", resolved, err)
	}
	legacy, err = service.target(reference)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := remote.Index(legacy, remote.WithContext(t.Context()), remote.WithTransport(service.transport)); err != nil {
		t.Fatal("迁移移除了旧仓库数据", err)
	}
	current, _, err := service.Default(t.Context(), "amd64")
	if err != nil || current != "registry.example/environments/dev:v20261106" {
		t.Fatal(current, err)
	}
}
