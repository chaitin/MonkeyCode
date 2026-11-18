//go:build linux

package vmimage

import (
	"archive/tar"
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"
)

type conversionDiagnostic struct{ data []byte }

func (d *conversionDiagnostic) Write(p []byte) (int, error) {
	n := len(p)
	left := 8192 - len(d.data)
	if len(p) > left {
		p = p[:left]
	}
	d.data = append(d.data, p...)
	return n, nil
}

func TestConversionIntegration(t *testing.T) {
	if os.Getenv("MONKEYAI_CONVERT_TEST") != "1" {
		t.Skip("需在隔离Linux环境显式启用umoci/ext4转换验收")
	}
	for _, media := range []string{ociManifest, dockerManifest} {
		t.Run(media, func(t *testing.T) { conversionIntegration(t, media) })
	}
}

func conversionIntegration(t *testing.T, media string) {
	tool := func(name string) Tool {
		path, err := exec.LookPath(name)
		if err != nil {
			t.Fatal(err)
		}
		path, err = filepath.EvalSymlinks(path)
		if err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return Tool{Path: path, Digest: digestBytes(data)}
	}
	base := t.TempDir()
	layout := filepath.Join(base, "oci")
	if err := os.Mkdir(layout, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(layout, "oci-layout"), []byte(`{"imageLayoutVersion":"1.0.0"}`), 0600); err != nil {
		t.Fatal(err)
	}
	layer := func(names, contents []string) Descriptor {
		var data bytes.Buffer
		tw := tar.NewWriter(&data)
		for i, name := range names {
			header := &tar.Header{Name: name, Mode: 0644, Uid: 0, Gid: 0, Size: int64(len(contents[i])), Typeflag: tar.TypeReg}
			if name == "bin/metadata-proof" {
				header.Mode, header.Gid = 06755, 42
			}
			if err := tw.WriteHeader(header); err != nil {
				t.Fatal(err)
			}
			if _, err := tw.Write([]byte(contents[i])); err != nil {
				t.Fatal(err)
			}
		}
		if err := tw.Close(); err != nil {
			t.Fatal(err)
		}
		layerMedia := "application/vnd.oci.image.layer.v1.tar"
		if media == dockerManifest {
			layerMedia = "application/vnd.docker.image.rootfs.diff.tar"
		}
		return putBlob(t, layout, layerMedia, data.Bytes())
	}
	first := layer([]string{"keep", "removed", "bin/metadata-proof"}, []string{"original", "delete-me", "metadata only; never execute"})
	second := layer([]string{".wh.removed", "keep"}, []string{"", "updated"})
	configMedia := "application/vnd.oci.image.config.v1+json"
	if media == dockerManifest {
		configMedia = "application/vnd.docker.container.image.v1+json"
	}
	config := putJSON(t, layout, configMedia, map[string]any{"architecture": runtime.GOARCH, "os": "linux", "rootfs": map[string]any{"type": "layers", "diff_ids": []string{first.Digest, second.Digest}}, "config": map[string]any{}})
	manifest := putJSON(t, layout, media, imageManifest{SchemaVersion: 2, MediaType: media, Config: config, Layers: []Descriptor{first, second}})
	asset := filepath.Join(base, "bootstrap")
	if err := os.WriteFile(asset, []byte("platform-bootstrap"), 0600); err != nil {
		t.Fatal(err)
	}
	converter := &Converter{Unpack: tool("umoci"), Mkfs: tool("mke2fs"), Assets: []Asset{{Target: "opt/monkeyai/bootstrap", Digest: digestBytes([]byte("platform-bootstrap")), Mode: 0755, Source: asset}}, Limits: Limits{Bytes: 4 << 20, Files: 1000, Timeout: time.Minute}}
	converter.run = func(ctx context.Context, tool Tool, args ...string) error {
		command := exec.CommandContext(ctx, tool.Path, args...)
		var diagnostic conversionDiagnostic
		command.Stderr = &diagnostic
		if err := command.Run(); err != nil {
			t.Logf("受控测试解包诊断: %s", diagnostic.data)
			return err
		}
		return nil
	}
	implementation := Tool{}
	if executable := os.Getenv("MONKEYAI_CONVERT_ENGINE"); executable != "" {
		implementation = tool(executable)
		converter.ImplementationDigest = implementation.Digest
	}
	cd, bd, err := converter.Identity()
	if err != nil {
		t.Fatal(err)
	}
	cache, err := New(filepath.Join(base, "cache"))
	if err != nil {
		t.Fatal(err)
	}
	id := Identity{Architecture: runtime.GOARCH, ImageDigest: manifest.Digest, ConverterDigest: cd, KernelDigest: cd, BootstrapDigest: bd, DiskBytes: 64 << 20}
	build := converter.Build(layout)
	if implementation.Path != "" {
		build = converter.BuildIsolated(layout, implementation)
	}
	template, err := cache.Ensure(context.Background(), id, build)
	if err != nil {
		t.Fatal(err)
	}
	debug, err := exec.LookPath("debugfs")
	if err != nil {
		t.Fatal(err)
	}
	for _, pair := range []struct{ path, want string }{{"/keep", "updated"}, {"/opt/monkeyai/bootstrap", "platform-bootstrap"}} {
		data, err := exec.Command(debug, "-R", "cat "+pair.path, template.Path).CombinedOutput()
		if err != nil || !strings.Contains(string(data), pair.want) {
			t.Fatalf("转换后文件不符: %s %s %v", pair.path, data, err)
		}
	}
	data, err := exec.Command(debug, "-R", "stat /bin/metadata-proof", template.Path).CombinedOutput()
	if err != nil || !strings.Contains(string(data), "06755") || !regexp.MustCompile(`User:\s+0\s+Group:\s+42\b`).Match(data) {
		t.Fatalf("SUID/SGID与所有权未正确进入虚拟机磁盘: %s %v", data, err)
	}
	data, err = exec.Command(debug, "-R", "stat /removed", template.Path).CombinedOutput()
	if err != nil || !strings.Contains(string(data), "File not found") {
		t.Fatalf("whiteout未生效: %s %v", data, err)
	}
	replay, err := cache.Ensure(context.Background(), id, nil)
	if err != nil || replay != template {
		t.Fatal("缓存复用失败", replay, err)
	}
}
