package vmhost

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/cache"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmimage"
)

func TestTemplateDeletionRejectsPinsAndNeverTouchesDisks(t *testing.T) {
	root := t.TempDir()
	templates := filepath.Join(root, "templates")
	if err := os.Mkdir(templates, 0700); err != nil {
		t.Fatal(err)
	}
	digest := "sha256:" + strings.Repeat("a", 64)
	identity := vmimage.Identity{Architecture: "amd64", ImageDigest: digest, ConverterDigest: digest, KernelDigest: digest, BootstrapDigest: digest, SystemBytes: 64 << 20}
	key, err := identity.Key()
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(templates, key)
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(filepath.Join(directory, "root.ext4"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0400)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(identity.SystemBytes); err != nil {
		t.Fatal(err)
	}
	file.Close()
	metadata, _ := json.Marshal(vmimage.Template{Identity: identity, SHA256: digest})
	if err := os.WriteFile(filepath.Join(directory, "manifest.json"), metadata, 0600); err != nil {
		t.Fatal(err)
	}
	disks := filepath.Join(root, "user-data")
	if err := os.WriteFile(disks, []byte("persistent"), 0600); err != nil {
		t.Fatal(err)
	}
	store := templateStore{root: templates, pinned: map[string]bool{key: true}, data: root}
	target := cache.Image{Name: key, Target: digest, Managed: true}
	if err := store.Delete(t.Context(), target); err == nil {
		t.Fatal("回收了被引用模板")
	}
	store.pinned = map[string]bool{}
	if err := store.Delete(t.Context(), target); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(directory); !os.IsNotExist(err) {
		t.Fatal("模板未被移除", err)
	}
	if raw, err := os.ReadFile(disks); err != nil || string(raw) != "persistent" {
		t.Fatal("回收影响用户盘", err)
	}
}
func TestTemplateReferencesRefuseUnregisteredDiskDirectories(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "disks", strings.Repeat("a", 64)), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := diskTemplateReferences(filepath.Join(root, "records")); err == nil {
		t.Fatal("磁盘登记丢失却允许模板回收")
	}
}
