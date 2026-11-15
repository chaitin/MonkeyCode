package runtimeupdate

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func packageFixture(version string) (lifecycle.RuntimePackage, map[string][]byte) {
	program := make([]byte, 64)
	copy(program, []byte{0x7f, 'E', 'L', 'F', 2, 1, 1})
	binary.LittleEndian.PutUint16(program[16:], 2)
	machine := uint16(62)
	if runtime.GOARCH == "arm64" {
		machine = 183
	}
	binary.LittleEndian.PutUint16(program[18:], machine)
	binary.LittleEndian.PutUint32(program[20:], 1)
	binary.LittleEndian.PutUint16(program[52:], 64)
	binary.LittleEndian.PutUint16(program[54:], 56)
	binary.LittleEndian.PutUint16(program[58:], 64)
	program = append(program, version...)
	files := map[string][]byte{"monkeyai-runtime": program, "ohmyagent": program, "LICENSES.txt": []byte("license")}
	hash := sha256.Sum256(program)
	files["bundle.json"], _ = json.Marshal(map[string]any{"version": version, "os": "linux", "arch": runtime.GOARCH, "engineSha256": hex.EncodeToString(hash[:]), "engineSize": len(program)})
	release := lifecycle.RuntimePackage{Version: version, Architecture: runtime.GOARCH, Files: map[string]lifecycle.RuntimeFile{}}
	for name, data := range files {
		sum := sha256.Sum256(data)
		release.Files[name] = lifecycle.RuntimeFile{SHA256: hex.EncodeToString(sum[:]), Size: int64(len(data))}
	}
	return release, files
}
func TestRuntimeUpdateIsAtomicAndKeepsIdentity(t *testing.T) {
	for _, secure := range []bool{false, true} {
		name := "http"
		if secure {
			name = "https"
		}
		t.Run(name, func(t *testing.T) { testAtomicUpdate(t, secure) })
	}
}

func testAtomicUpdate(t *testing.T, secure bool) {
	first, firstFiles := packageFixture("26.1105.1")
	second, secondFiles := packageFixture("26.1105.2")
	var corrupt atomic.Bool
	var requests atomic.Int64
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		parts := strings.Split(r.URL.Path, "/")
		name := parts[len(parts)-1]
		files := firstFiles
		if strings.Contains(r.URL.Path, second.Version) {
			files = secondFiles
		}
		if corrupt.Load() && name == "ohmyagent" {
			w.Write([]byte("corrupt"))
			return
		}
		data, ok := files[name]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Write(data)
	}))
	if secure {
		server.StartTLS()
	} else {
		server.Start()
	}
	defer server.Close()
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	client, err := control.New(server.URL, key)
	if err != nil {
		t.Fatal(err)
	}
	client.WithInsecure(secure)
	root := t.TempDir()
	if err := os.Chmod(root, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "state"), 0700); err != nil {
		t.Fatal(err)
	}
	identity := filepath.Join(root, "state", "installation.key")
	if err := os.WriteFile(identity, []byte("retained identity"), 0600); err != nil {
		t.Fatal(err)
	}
	manager := New(root, client)
	if err := manager.Update(t.Context(), first); err != nil {
		t.Fatal(err)
	}
	current, err := manager.Current()
	if err != nil || current.Version != first.Version || !strings.HasPrefix(current.Binary, "/var/lib/monkeyai/_engine/releases/") {
		t.Fatal(current, err)
	}
	corrupt.Store(true)
	if err := manager.Update(t.Context(), second); err == nil {
		t.Fatal("接受损坏更新")
	}
	current, err = New(root, client).Current()
	if err != nil || current.Version != first.Version {
		t.Fatal("失败更新覆盖旧版本", current, err)
	}
	corrupt.Store(false)
	if err := manager.Update(t.Context(), second); err != nil {
		t.Fatal(err)
	}
	current, err = manager.Current()
	if err != nil || current.Version != second.Version {
		t.Fatal(current, err)
	}
	for _, path := range []string{filepath.Join(root, directory), filepath.Join(root, directory, "releases"), filepath.Join(root, directory, "releases", second.Version)} {
		if err := os.Chmod(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := New(root, client).Current(); err != nil {
		t.Fatal("已有受控程序目录无法修复访问权限", err)
	}
	for _, path := range []string{filepath.Join(root, directory), filepath.Join(root, directory, "releases"), filepath.Join(root, directory, "releases", second.Version)} {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm() != 0755 {
			t.Fatal("UID1000无法遍历程序目录", path, info, err)
		}
	}
	before := requests.Load()
	if err := manager.Update(t.Context(), first); err != nil {
		t.Fatal("回退失败", err)
	}
	if requests.Load() != before {
		t.Fatal("已缓存版本回退仍然下载")
	}
	data, err := os.ReadFile(identity)
	if err != nil || string(data) != "retained identity" {
		t.Fatal("更新改变了设备身份", err)
	}
}
func TestRuntimeManagerRejectsUntrustedFiles(t *testing.T) {
	root := t.TempDir()
	if err := os.Chmod(root, 0755); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, directory)); err != nil {
		t.Fatal(err)
	}
	if _, err := New(root, nil).Current(); err == nil {
		t.Fatal("接受可跳出持久目录的符号链接")
	}
}
