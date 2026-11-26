package kb

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestImportKeyIsPersistentAndConcurrent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "kb-import-signing.key")
	keys := make([]string, 8)
	errs := make([]error, 8)
	var group sync.WaitGroup
	for i := range keys {
		group.Add(1)
		go func() { defer group.Done(); keys[i], errs[i] = LoadImportSigningKey(path) }()
	}
	group.Wait()
	for i, key := range keys {
		if errs[i] != nil || len(key) != 64 || key != keys[0] {
			t.Fatalf("key %d differs or failed: %v", i, errs[i])
		}
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("permissions %v %v", info, err)
	}
	other, err := LoadImportSigningKey(filepath.Join(t.TempDir(), "key"))
	if err != nil || other == keys[0] {
		t.Fatal("installations share secret", err)
	}
}
func TestImportKeyRejectsInvalidExistingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "key")
	if err := os.WriteFile(path, []byte("bad"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadImportSigningKey(path); err == nil {
		t.Fatal("regenerated corrupt secret")
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadImportSigningKey(path); err == nil {
		t.Fatal("accepted public file")
	}
}
