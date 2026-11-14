package envimage

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/go-containerregistry/pkg/v1/empty"
	"github.com/google/go-containerregistry/pkg/v1/layout"
)

func importFixture(t *testing.T) (string, string) {
	t.Helper()
	index := versionedIndex(t, "runtime-26.1105.2-v26110501")
	digest, err := index.Digest()
	if err != nil {
		t.Fatal(err)
	}
	reference := "upstream.invalid/monkeyai-environment@" + digest.String()
	root := t.TempDir()
	folder, err := layout.Write(filepath.Join(root, Key(reference)), empty.Index)
	if err != nil {
		t.Fatal(err)
	}
	if err := folder.AppendIndex(index); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal([]string{reference})
	if err := os.WriteFile(filepath.Join(root, "catalog.json"), raw, 0644); err != nil {
		t.Fatal(err)
	}
	return root, reference
}
func TestPreparePersistsDefaultWithoutImportDirectory(t *testing.T) {
	input, reference := importFixture(t)
	state := t.TempDir()
	service, err := New(t.Context(), state, "https://registry.example")
	if err != nil {
		t.Fatal(err)
	}
	before, err := service.Check(t.Context(), reference)
	if err != nil || before.Ready {
		t.Fatal(before, err)
	}
	status, err := service.Prepare(t.Context(), reference, input)
	if err != nil || !status.Ready || !status.Default || len(status.Architectures) != 2 || strings.Contains(status.Reference, "@") {
		t.Fatal(status, err)
	}
	service.Close()
	if err := os.RemoveAll(input); err != nil {
		t.Fatal(err)
	}
	service, err = New(t.Context(), state, "https://registry.example")
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	if err := service.Import(t.Context(), input); err != nil {
		t.Fatal("旧配置输入目录缺失仍阻止启动", err)
	}
	restored, err := service.Prepare(t.Context(), reference, "")
	if err != nil || !restored.Ready || !restored.Default || restored.Reference != status.Reference {
		t.Fatal("完整Registry仍需下载或原OCI目录", restored, err)
	}
	current, digest, err := service.Default(t.Context(), "arm64")
	if err != nil || current != status.Reference || !strings.HasPrefix(digest, "sha256:") {
		t.Fatal(current, digest, err)
	}
}
func TestEnvironmentCommandDoesNotNeedDatabase(t *testing.T) {
	input, reference := importFixture(t)
	state := t.TempDir()
	t.Setenv("MONKEYAI_DATABASE_URL", "")
	args := []string{"--state-dir", state, "--public-url", "https://registry.example", "--image", reference}
	var output bytes.Buffer
	if err := Command(t.Context(), append(append([]string{}, args...), "--check"), &output); err != nil {
		t.Fatal(err)
	}
	var status ImportStatus
	if json.Unmarshal(output.Bytes(), &status) != nil || status.Ready {
		t.Fatal(output.String())
	}
	output.Reset()
	if err := Command(t.Context(), append(append([]string{}, args...), "--directory", input), &output); err != nil {
		t.Fatal(err)
	}
	if json.Unmarshal(output.Bytes(), &status) != nil || !status.Ready || !status.Default {
		t.Fatal(output.String())
	}
	output.Reset()
	if err := Command(t.Context(), append(args, "--check"), &output); err != nil {
		t.Fatal(err)
	}
	if json.Unmarshal(output.Bytes(), &status) != nil || !status.Ready {
		t.Fatal(output.String())
	}
}
func TestRegistryCheckRejectsCorruptStoredLayer(t *testing.T) {
	input, reference := importFixture(t)
	root := t.TempDir()
	service, err := New(t.Context(), root, "https://registry.example")
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	if _, err := service.Prepare(t.Context(), reference, input); err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob(filepath.Join(root, "registry", "docker", "registry", "v2", "blobs", "sha256", "*", "*", "data"))
	if err != nil || len(files) == 0 {
		t.Fatal("未找到Registry持久文件", files, err)
	}
	path := files[0]
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) == 0 {
		t.Fatal(err)
	}
	raw[0] ^= 1
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if status, err := service.Check(t.Context(), reference); err == nil || status.Ready {
		t.Fatal("同长度损坏Registry仍确认完整", status, err)
	}
	if _, err := service.Prepare(t.Context(), reference, ""); err == nil {
		t.Fatal("损坏缓存仍确认可以清理输入")
	}
	if _, err := os.Stat(filepath.Join(input, "catalog.json")); err != nil {
		t.Fatal("损坏Registry时删除了输入", err)
	}
}

func TestIncompleteImportDoesNotReplaceDefaultOrDiscardInput(t *testing.T) {
	input, reference := importFixture(t)
	service, err := New(t.Context(), t.TempDir(), "https://registry.example")
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	first, err := service.Prepare(t.Context(), reference, input)
	if err != nil {
		t.Fatal(err)
	}
	broken, next := importFixture(t)
	if err := os.RemoveAll(filepath.Join(broken, Key(next), "blobs")); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Prepare(t.Context(), next, broken); err == nil {
		t.Fatal("残缺输入仍确认导入成功")
	}
	current, _, err := service.Default(t.Context(), "amd64")
	if err != nil || current != first.Reference {
		t.Fatal("失败导入替换默认镜像", current, err)
	}
	if _, err := os.Stat(filepath.Join(broken, "catalog.json")); err != nil {
		t.Fatal("失败时删除了唯一输入", err)
	}
}
