package driver

import (
	"archive/tar"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockerapi"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func TestRuntimePreparationReusesOrExtractsInIsolatedContainers(t *testing.T) {
	for _, mode := range []string{"image", "cached", "extract", "revision", "corrupt", "setup-failed"} {
		t.Run(mode, func(t *testing.T) {
			work, err := os.MkdirTemp("/tmp", "ma-runtime-")
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(work)
			socket := filepath.Join(work, "docker.sock")
			listener, err := net.Listen("unix", socket)
			if err != nil {
				t.Fatal(err)
			}
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
			hash := func(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }
			payload := filepath.Join(work, "payload")
			if err := os.WriteFile(payload, program, 0755); err != nil {
				t.Fatal(err)
			}
			release := lifecycle.RuntimePackage{Version: "26.1105.2", Architecture: runtime.GOARCH, RuntimeRevision: strings.Repeat("a", 40), EngineRevision: strings.Repeat("b", 40), Files: map[string]lifecycle.RuntimeFile{"monkeyai-runtime": {SHA256: hash(program), Size: int64(len(program))}}}
			info := runtimeBundle{Schema: 1, Version: release.Version, OS: "linux", Arch: runtime.GOARCH, RuntimeRevision: release.RuntimeRevision, EngineRevision: release.EngineRevision, EngineSize: int64(len(program)), EngineSHA256: hash(program), LicenseSHA256: hash([]byte("license"))}
			if mode == "revision" {
				info.EngineRevision = strings.Repeat("c", 40)
			}
			bundle, _ := json.Marshal(info)
			spec := sample()
			var creates, removes atomic.Int64
			server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				path := strings.TrimPrefix(r.URL.Path, "/v1.47")
				switch {
				case path == "/containers/json":
					io.WriteString(w, "[]")
				case strings.HasPrefix(path, "/images/"):
					image := imageInfo{ID: "sha256:" + strings.Repeat("c", 64), RepoDigests: []string{spec.Image}, Os: "linux", Architecture: runtime.GOARCH, Size: 1024}
					image.Config.Cmd = []string{"sleep", "infinity"}
					image.Config.Env = []string{"PRIVATE_KEY=secret", "LD_PRELOAD=/evil"}
					_ = json.NewEncoder(w).Encode(image)
				case path == "/containers/create":
					var body createBody
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					h := body.HostConfig
					if body.User != "0:0" || h.NetworkMode != "none" || len(h.Mounts) != 0 || len(h.Binds) != 0 || h.Privileged || h.Runtime != dockerapi.Runtime || h.Memory != 1<<30 || h.PidsLimit != 256 || len(h.CapDrop) != 1 || h.CapDrop[0] != "ALL" || !strings.Contains(strings.Join(body.Env, ";"), "PRIVATE_KEY=;LD_PRELOAD=") {
						t.Errorf("准备容器隔离配置无效: %+v", body)
					}
					id := creates.Add(1)
					if id == 2 && (!strings.Contains(strings.Join(body.Cmd, " "), "rm -f /usr/local/bin/monkeyai-runtime") || !strings.Contains(strings.Join(body.Cmd, " "), "setup --install-only --run-as monkey")) {
						t.Error("释放前未清理镜像旧命令入口或未使用无身份安装")
					}
					_ = json.NewEncoder(w).Encode(map[string]string{"Id": fmt.Sprint("helper-", id)})
				case r.Method == "PUT" && strings.HasSuffix(path, "/archive"):
					if r.Header.Get("Content-Type") != "application/x-tar" {
						t.Error("上传协议错误")
					}
					archive := tar.NewReader(r.Body)
					header, err := archive.Next()
					if err != nil || header.Name != "monkeyai-runtime" {
						t.Error("原始程序归档错误", err)
						w.WriteHeader(400)
						return
					}
					body, _ := io.ReadAll(archive)
					if hash(body) != release.Files["monkeyai-runtime"].SHA256 {
						t.Error("上传的官方程序发生变化")
					}
					w.WriteHeader(200)
				case r.Method == "GET" && strings.HasSuffix(path, "/archive"):
					source := r.URL.Query().Get("path")
					var body []byte
					switch source {
					case "/tmp/bundle.json":
						body = bundle
					case "/tmp/LICENSES.txt":
						body = []byte("license")
					case "/opt/monkeyai/ohmyagent":
						if mode != "image" {
							http.NotFound(w, r)
							return
						}
						body = program
					default:
						if !strings.Contains(source, "/versions/"+release.Version+"-") {
							t.Error("无效的释放路径", source)
						}
						body = program
						if mode == "corrupt" {
							body = []byte("corrupt")
						}
					}
					archive := tar.NewWriter(w)
					_ = archive.WriteHeader(&tar.Header{Name: filepath.Base(source), Mode: 0755, Size: int64(len(body)), Typeflag: tar.TypeReg})
					_, _ = archive.Write(body)
					_ = archive.Close()
				case strings.HasSuffix(path, "/start"):
					w.WriteHeader(204)
				case strings.HasSuffix(path, "/wait"):
					code := 0
					if mode == "setup-failed" && creates.Load() == 2 {
						code = 1
					}
					_ = json.NewEncoder(w).Encode(map[string]int{"StatusCode": code})
				case r.Method == "DELETE":
					removes.Add(1)
					w.WriteHeader(204)
				default:
					t.Error("未预期的Docker操作", r.Method, path)
					http.NotFound(w, r)
				}
			})}
			go server.Serve(listener)
			defer server.Close()
			driver := &Driver{client: dockerapi.New(socket)}
			defer driver.Close()
			destination := filepath.Join(work, "prepared")
			_ = os.Mkdir(destination, 0700)
			var reuse []string
			if mode == "cached" {
				candidate := filepath.Join(work, "old-engine")
				_ = os.WriteFile(candidate, program, 0755)
				reuse = []string{candidate}
			}
			prepared, err := driver.PrepareRuntime(t.Context(), spec, payload, destination, release, reuse)
			if mode == "revision" || mode == "corrupt" || mode == "setup-failed" {
				if err == nil {
					t.Fatal("无效的准备结果被接受")
				}
			} else {
				if err != nil || prepared.Validate() != nil || prepared.SingleFile() || prepared.Files["ohmyagent"].SHA256 != info.EngineSHA256 {
					t.Fatal(prepared, err)
				}
				expected := int64(1)
				if mode == "extract" {
					expected = 2
				}
				if creates.Load() != expected {
					t.Fatal("没有优先复用已匹配的引擎", creates.Load(), expected)
				}
			}
			if creates.Load() != removes.Load() {
				t.Fatal("准备容器未清理", creates.Load(), removes.Load())
			}
		})
	}
}
