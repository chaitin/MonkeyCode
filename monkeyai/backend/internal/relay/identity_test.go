package relay

import (
	"bytes"
	"crypto/ed25519"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
)

func TestDefaultIdentitySurvivesRestartAndConcurrentStartup(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "runtime")
	const count = 8
	type result struct {
		state serverIdentity
		err   error
	}
	results := make(chan result, count)
	var workers sync.WaitGroup
	for range count {
		workers.Go(func() {
			state, err := loadIdentity(dir)
			results <- result{state, err}
		})
	}
	workers.Wait()
	close(results)
	stored, err := loadIdentity(dir)
	if err != nil {
		t.Fatal(err)
	}
	for value := range results {
		if value.err != nil || value.state != stored {
			t.Fatalf("并发启动未复用同一控制面身份: %v", value.err)
		}
	}
	info, err := os.Stat(filepath.Join(dir, "identity.json"))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatal("身份文件权限应为 0600")
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("临时身份文件未清理: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	config := Config{StateDir: dir, PublicURL: "http://localhost"}
	first, err := NewService(nil, nil, nil, logger, config)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewService(nil, nil, nil, logger, config)
	if err != nil {
		t.Fatal(err)
	}
	if first.config.ServerID != stored.ServerID || first.config.ServerID != second.config.ServerID || !first.key.Equal(second.key) || first.config.FilesOrigin != config.PublicURL {
		t.Fatal("默认中转配置没有保持稳定身份和文件 origin")
	}
}

func TestIdentityFailureDoesNotReplaceExistingState(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "identity.json")
	original := []byte(`{"server_id":"broken","private_key":"broken"}`)
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadIdentity(dir); err == nil {
		t.Fatal("损坏身份不能自动重建")
	}
	current, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(current, original) {
		t.Fatal("已有身份文件被覆盖")
	}
	file := filepath.Join(dir, "not-a-directory")
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadIdentity(filepath.Join(file, "runtime")); err == nil {
		t.Fatal("不能保存身份时不应假装成功")
	}
}

func TestExplicitSigningKeyIsNotRegenerated(t *testing.T) {
	dir := t.TempDir()
	state, err := loadIdentity(dir)
	if err != nil {
		t.Fatal(err)
	}
	keyPath := filepath.Join(t.TempDir(), "access.pem")
	if err := os.WriteFile(keyPath, []byte(state.PrivateKey), 0600); err != nil {
		t.Fatal(err)
	}
	unused := filepath.Join(t.TempDir(), "unused")
	config := Config{ServerID: state.ServerID, SigningKeyFile: keyPath, StateDir: unused}
	key, err := resolveIdentity(&config)
	if err != nil || len(key) != ed25519.PrivateKeySize {
		t.Fatalf("显式密钥未加载: %v", err)
	}
	if _, err := os.Stat(unused); !os.IsNotExist(err) {
		t.Fatal("完整显式配置不应创建默认身份")
	}
	if err := os.Remove(keyPath); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveIdentity(&config); err == nil {
		t.Fatal("显式密钥缺失不能回退随机新密钥")
	}
}
