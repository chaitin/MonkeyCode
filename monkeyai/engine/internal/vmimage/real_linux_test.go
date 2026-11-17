//go:build linux

package vmimage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestProvidedImageConversion(t *testing.T) {
	if os.Getenv("MONKEYAI_REAL_CONVERSION_TEST") != "1" {
		t.Skip("显式使用独立诊断目录验收真实镜像隔离转换")
	}
	base := os.Getenv("MONKEYAI_REAL_CONVERSION_ROOT")
	if !filepath.IsAbs(base) || base == "/" || os.Geteuid() != 0 {
		t.Fatal("需要Linux root和独立目录")
	}
	raw, err := os.ReadFile(filepath.Join(base, "sandbox/request.json"))
	if err != nil {
		t.Fatal(err)
	}
	var request SandboxRequest
	if err := json.Unmarshal(raw, &request); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(base, "sandbox/bin/engine-fixed")
	file, err := os.Open(binary)
	if err != nil {
		t.Fatal(err)
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		t.Fatal(err)
	}
	file.Close()
	if !info.Mode().IsRegular() {
		t.Fatal("转换程序不是普通文件")
	}
	data, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	implementation := Tool{Path: binary, Digest: digestBytes(data)}
	converter := Converter{Unpack: Tool{Path: filepath.Join(base, "sandbox/bin/umoci"), Digest: request.Unpack.Digest}, Mkfs: Tool{Path: filepath.Join(base, "sandbox/bin/mke2fs"), Digest: request.Mkfs.Digest}, ImplementationDigest: implementation.Digest, Limits: request.Limits}
	for _, wire := range request.Assets {
		asset := wire.Asset
		asset.Source = filepath.Join(base, "sandbox", wire.File)
		data, err := os.ReadFile(asset.Source)
		if err != nil {
			t.Fatal(err)
		}
		asset.Digest = digestBytes(data)
		converter.Assets = append(converter.Assets, asset)
	}
	identity := request.Identity
	identity.ConverterDigest, identity.BootstrapDigest, err = converter.Identity()
	if err != nil {
		t.Fatal(err)
	}
	cache, err := New(filepath.Join(base, "clean-conversion-cache"))
	if err != nil {
		t.Fatal(err)
	}
	template, err := cache.Ensure(t.Context(), identity, converter.BuildIsolated(filepath.Join(base, "sandbox/oci"), implementation))
	if err != nil {
		t.Fatal(err)
	}
	result := struct {
		Path     string   `json:"path"`
		SHA256   string   `json:"sha256"`
		Identity Identity `json:"identity"`
	}{template.Path, template.SHA256, template.Identity}
	raw, err = json.MarshalIndent(result, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, "clean-template.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("真实镜像隔离转换完成：%s sha256=%s", template.Path, template.SHA256)
}
