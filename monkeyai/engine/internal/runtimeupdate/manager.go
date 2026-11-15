package runtimeupdate

import (
	"context"
	"crypto/sha256"
	"debug/elf"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"syscall"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
)

const directory = "_engine"

type Preparer func(context.Context, string, string, lifecycle.RuntimePackage, []string) (lifecycle.RuntimePackage, error)
type Manager struct {
	root    string
	client  *control.Client
	prepare Preparer
}

func (m *Manager) WithPreparer(prepare Preparer) *Manager { m.prepare = prepare; return m }

func New(root string, client *control.Client) *Manager { return &Manager{root: root, client: client} }
func owned(path string, dir bool) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	owner, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(owner.Uid) != os.Geteuid() || info.Mode().Perm()&0022 != 0 || info.IsDir() != dir || !dir && !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("runtime 管理目录或文件归属不安全")
	}
	return nil
}
func programDirectory(path string) error {
	if err := owned(path, true); err != nil {
		return err
	}
	return os.Chmod(path, 0755)
}
func (m *Manager) protected() bool {
	info, err := os.Lstat(m.root)
	if err != nil || info.Mode().Perm() != 0755 {
		return false
	}
	return owned(m.root, true) == nil
}
func (m *Manager) Current() (standalone.Files, error) {
	if !m.protected() {
		return standalone.Files{}, nil
	}
	root := filepath.Join(m.root, directory)
	if err := owned(root, true); os.IsNotExist(err) {
		return standalone.Files{}, nil
	} else if err != nil {
		return standalone.Files{}, err
	}
	path := filepath.Join(root, "current.json")
	if err := owned(path, false); os.IsNotExist(err) {
		return standalone.Files{}, nil
	} else if err != nil {
		return standalone.Files{}, err
	}
	raw, err := os.ReadFile(path)
	var release lifecycle.RuntimePackage
	if err != nil || len(raw) > 16<<10 || json.Unmarshal(raw, &release) != nil || release.Validate() != nil || release.SingleFile() || release.Architecture != runtime.GOARCH {
		return standalone.Files{}, errors.New("runtime 当前版本记录无效")
	}
	version := filepath.Join(root, "releases", release.Version)
	for _, path := range []string{root, filepath.Join(root, "releases"), version} {
		if err := programDirectory(path); err != nil {
			return standalone.Files{}, err
		}
	}
	if err := validateFiles(version, release, false); err != nil {
		return standalone.Files{}, err
	}
	guest := filepath.Join("/var/lib/monkeyai", directory, "releases", release.Version)
	return standalone.Files{Binary: filepath.Join(guest, "monkeyai-runtime"), Engine: filepath.Join(guest, "ohmyagent"), Version: release.Version}, nil
}
func validateFiles(root string, release lifecycle.RuntimePackage, checksums bool) error {
	if err := owned(root, true); err != nil {
		return err
	}
	for name, expected := range release.Files {
		path := filepath.Join(root, name)
		if err := owned(path, false); err != nil {
			return err
		}
		info, err := os.Lstat(path)
		if err != nil || info.Size() != expected.Size {
			return errors.New("runtime 文件大小发生变化")
		}
		if (name == "monkeyai-runtime" || name == "ohmyagent") && info.Mode().Perm() != 0755 {
			return errors.New("runtime 程序权限无效")
		}
		if checksums {
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			hash := sha256.New()
			_, err = io.Copy(hash, file)
			file.Close()
			if err != nil || hex.EncodeToString(hash.Sum(nil)) != expected.SHA256 {
				return errors.New("runtime 文件摘要不匹配")
			}
		}
	}
	return nil
}
func (m *Manager) Update(ctx context.Context, release lifecycle.RuntimePackage) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := release.Validate(); err != nil {
		return err
	}
	if release.Architecture != runtime.GOARCH || m.client == nil || !m.protected() {
		return errors.New("runtime 更新需要匹配架构、server连接及受保护的持久目录")
	}
	root := filepath.Join(m.root, directory)
	for _, path := range []string{root, filepath.Join(root, "releases")} {
		if err := os.Mkdir(path, 0755); err != nil && !os.IsExist(err) {
			return err
		}
		if err := programDirectory(path); err != nil {
			return err
		}
	}
	target := filepath.Join(root, "releases", release.Version)
	if err := owned(target, true); err == nil {
		raw, err := os.ReadFile(filepath.Join(target, "package.json"))
		var previous lifecycle.RuntimePackage
		if err != nil || json.Unmarshal(raw, &previous) != nil {
			return errors.New("runtime 已有版本记录无效")
		}
		adopt := release.SingleFile() && previous.RuntimeRevision == "" && previous.EngineRevision == ""
		if adopt {
			previous.RuntimeRevision = release.RuntimeRevision
			previous.EngineRevision = release.EngineRevision
		}
		if previous.Validate() != nil || previous.SingleFile() || !matchesRelease(previous, release) {
			return errors.New("同版本 runtime 内容不同，拒绝覆盖")
		}
		if err := programDirectory(target); err != nil {
			return err
		}
		if err := validateFiles(target, previous, true); err != nil {
			return err
		}
		if err := validateBinaries(target, previous); err != nil {
			return err
		}
		if adopt {
			raw, _ := json.Marshal(previous)
			if err := control.Write(filepath.Join(target, "package.json"), raw, 0600); err != nil {
				return err
			}
		}
		release = previous
	} else if os.IsNotExist(err) {
		stage, err := os.MkdirTemp(filepath.Dir(target), ".download-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(stage)
		for _, name := range []string{"monkeyai-runtime", "ohmyagent", "LICENSES.txt", "bundle.json"} {
			if _, ok := release.Files[name]; !ok {
				continue
			}
			if err := m.download(ctx, release, name, filepath.Join(stage, name)); err != nil {
				return err
			}
		}
		if release.SingleFile() {
			if m.prepare == nil {
				return errors.New("runtime 原始文件需要宿主隔离准备器")
			}
			prepared, err := m.prepare(ctx, filepath.Join(stage, "monkeyai-runtime"), stage, release, m.candidates(filepath.Join(root, "releases")))
			if err != nil {
				return err
			}
			if prepared.Validate() != nil || prepared.SingleFile() || !matchesRelease(prepared, release) {
				return errors.New("runtime 准备结果与官方文件不一致")
			}
			release = prepared
		}
		if err := validateFiles(stage, release, true); err != nil {
			return err
		}
		if err := validateBinaries(stage, release); err != nil {
			return err
		}
		raw, _ := json.Marshal(release)
		if err := control.Write(filepath.Join(stage, "package.json"), raw, 0600); err != nil {
			return err
		}
		if err := os.Chmod(stage, 0755); err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := os.Rename(stage, target); err != nil {
			return err
		}
	} else {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	raw, _ := json.Marshal(release)
	return control.Write(filepath.Join(root, "current.json"), raw, 0600)
}
func (m *Manager) download(ctx context.Context, release lifecycle.RuntimePackage, name, path string) error {
	expected := release.Files[name]
	client := *m.client.HTTP
	client.Timeout = 10 * time.Minute
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, m.client.Server+"/api/host/v1/runtime-releases/"+release.Version+"/"+release.Architecture+"/"+name, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.ContentLength > expected.Size {
		return errors.New("runtime 下载失败或长度不符合发行清单")
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(file, hash), io.LimitReader(response.Body, expected.Size+1))
	if err != nil || n != expected.Size || hex.EncodeToString(hash.Sum(nil)) != expected.SHA256 {
		return errors.New("runtime 下载文件摘要或长度不匹配")
	}
	mode := os.FileMode(0644)
	if name == "monkeyai-runtime" || name == "ohmyagent" {
		mode = 0755
	}
	if err := file.Chmod(mode); err != nil {
		return err
	}
	return file.Sync()
}
func validateBinaries(root string, release lifecycle.RuntimePackage) error {
	machine := elf.EM_X86_64
	if release.Architecture == "arm64" {
		machine = elf.EM_AARCH64
	}
	for _, name := range []string{"monkeyai-runtime", "ohmyagent"} {
		file, err := elf.Open(filepath.Join(root, name))
		if err != nil {
			return errors.New("runtime 程序不是有效 ELF")
		}
		valid := file.Machine == machine && file.Class == elf.ELFCLASS64 && file.Data == elf.ELFDATA2LSB && (file.Type == elf.ET_EXEC || file.Type == elf.ET_DYN)
		file.Close()
		if !valid {
			return errors.New("runtime 程序架构不匹配")
		}
	}
	raw, err := os.ReadFile(filepath.Join(root, "bundle.json"))
	var bundle struct {
		Version, OS, Arch string
		RuntimeRevision   string `json:"runtimeRevision"`
		EngineRevision    string `json:"engineRevision"`
		LicenseSHA256     string `json:"licenseSha256"`
		EngineSHA256      string `json:"engineSha256"`
		EngineSize        int64  `json:"engineSize"`
	}
	if err != nil || json.Unmarshal(raw, &bundle) != nil || bundle.Version != release.Version || bundle.OS != "linux" || bundle.Arch != release.Architecture || bundle.EngineSHA256 != release.Files["ohmyagent"].SHA256 || bundle.EngineSize != release.Files["ohmyagent"].Size {
		return errors.New("runtime 内嵌引擎与发行清单不一致")
	}
	if release.RuntimeRevision != "" && (bundle.RuntimeRevision != release.RuntimeRevision || bundle.EngineRevision != release.EngineRevision || bundle.LicenseSHA256 != release.Files["LICENSES.txt"].SHA256) {
		return errors.New("runtime 内嵌资源与官方源码修订不一致")
	}
	return nil
}

func matchesRelease(actual, wanted lifecycle.RuntimePackage) bool {
	if !wanted.SingleFile() {
		return reflect.DeepEqual(actual, wanted)
	}
	return actual.Version == wanted.Version && actual.Architecture == wanted.Architecture && actual.RuntimeRevision == wanted.RuntimeRevision && actual.EngineRevision == wanted.EngineRevision && actual.Files["monkeyai-runtime"] == wanted.Files["monkeyai-runtime"]
}
func (m *Manager) candidates(root string) []string {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var result []string
	for _, entry := range entries {
		folder := filepath.Join(root, entry.Name())
		path := filepath.Join(folder, "ohmyagent")
		if !lifecycle.ValidRuntimeVersion(entry.Name()) || owned(folder, true) != nil || owned(path, false) != nil {
			continue
		}
		result = append(result, path)
	}
	return result
}
