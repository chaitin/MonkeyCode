package driver

import (
	"archive/tar"
	"context"
	"crypto/sha256"
	"debug/elf"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockerapi"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

const runtimeHelperOwner = "engine-runtime"

type runtimeBundle struct {
	Schema          int    `json:"schema"`
	Development     bool   `json:"development"`
	Version         string `json:"version"`
	OS              string `json:"os"`
	Arch            string `json:"arch"`
	RuntimeRevision string `json:"runtimeRevision"`
	EngineRevision  string `json:"engineRevision"`
	EngineSize      int64  `json:"engineSize"`
	EngineSHA256    string `json:"engineSha256"`
	LicenseSHA256   string `json:"licenseSha256"`
}

func (d *Driver) PrepareRuntime(ctx context.Context, s lifecycle.Spec, payload, destination string, release lifecycle.RuntimePackage, reuse []string) (lifecycle.RuntimePackage, error) {
	if release.Validate() != nil || !release.SingleFile() || release.Architecture != runtime.GOARCH {
		return release, errors.New("runtime 准备需要当前架构的官方单文件")
	}
	file, err := elf.Open(payload)
	if err != nil {
		return release, err
	}
	machine := elf.EM_X86_64
	if runtime.GOARCH == "arm64" {
		machine = elf.EM_AARCH64
	}
	valid := file.Class == elf.ELFCLASS64 && file.Data == elf.ELFDATA2LSB && file.Machine == machine && (file.Type == elf.ET_EXEC || file.Type == elf.ET_DYN)
	file.Close()
	if !valid {
		return release, errors.New("runtime 原始程序架构无效")
	}
	if err := d.cleanupRuntimeHelpers(ctx, s); err != nil {
		return release, err
	}
	inspect := "umask 077; /tmp/monkeyai-runtime bundle-info > /tmp/bundle.json; /tmp/monkeyai-runtime licenses > /tmp/LICENSES.txt"
	err = d.runtimeHelper(ctx, s, payload, inspect, func(id string) error {
		if err := d.runtimeArtifact(ctx, id, "/tmp/bundle.json", filepath.Join(destination, "bundle.json"), 16<<10); err != nil {
			return err
		}
		if err := d.runtimeArtifact(ctx, id, "/tmp/LICENSES.txt", filepath.Join(destination, "LICENSES.txt"), 8<<20); err != nil {
			return err
		}
		raw, err := os.ReadFile(filepath.Join(destination, "bundle.json"))
		var bundle runtimeBundle
		if err != nil || json.Unmarshal(raw, &bundle) != nil || bundle.Schema != 1 || bundle.Development || bundle.Version != release.Version || bundle.OS != "linux" || bundle.Arch != release.Architecture || bundle.RuntimeRevision != release.RuntimeRevision || bundle.EngineRevision != release.EngineRevision || bundle.EngineSize < 1 || bundle.EngineSize > 512<<20 || len(bundle.EngineSHA256) != 64 || strings.Trim(bundle.EngineSHA256, "0123456789abcdef") != "" {
			return errors.New("runtime 内嵌信息与官方发行不一致")
		}
		notices, err := runtimeFile(filepath.Join(destination, "LICENSES.txt"))
		if err != nil || notices.SHA256 != bundle.LicenseSHA256 {
			return errors.New("runtime 许可证与内嵌信息不一致")
		}
		expected := lifecycle.RuntimeFile{SHA256: bundle.EngineSHA256, Size: bundle.EngineSize}
		target := filepath.Join(destination, "ohmyagent")
		reused := false
		for _, candidate := range reuse {
			if actual, err := runtimeFile(candidate); err == nil && actual == expected {
				if err := copyRuntimeEngine(candidate, target); err != nil {
					return err
				}
				reused = true
				break
			}
		}
		if !reused {
			if err := d.runtimeArtifact(ctx, id, "/opt/monkeyai/ohmyagent", target, bundle.EngineSize); err == nil {
				actual, err := runtimeFile(target)
				reused = err == nil && actual == expected
			}
		}
		if !reused {
			_ = os.Remove(target)
			install := "umask 077; rm -rf /opt/monkeyai-runtime /etc/monkeyai-runtime /var/lib/monkeyai-runtime; rm -f /usr/local/bin/monkeyai-runtime; /tmp/monkeyai-runtime setup --install-only --run-as monkey --json"
			if err := d.runtimeHelper(ctx, s, payload, install, func(helper string) error {
				source := "/opt/monkeyai-runtime/versions/" + release.Version + "-" + release.Files["monkeyai-runtime"].SHA256[:12] + "/ohmyagent"
				return d.runtimeArtifact(ctx, helper, source, target, bundle.EngineSize)
			}); err != nil {
				return err
			}
		}
		actual, err := runtimeFile(target)
		if err != nil || actual != expected {
			return errors.New("OhMyAgent 释放后的大小或摘要不符")
		}
		if err := os.Chmod(target, 0755); err != nil {
			return err
		}
		release.Files = maps.Clone(release.Files)
		release.Files["ohmyagent"] = actual
		release.Files["LICENSES.txt"] = notices
		release.Files["bundle.json"], err = runtimeFile(filepath.Join(destination, "bundle.json"))
		return err
	})
	return release, err
}
func runtimeFile(path string) (lifecycle.RuntimeFile, error) {
	var result lifecycle.RuntimeFile
	info, err := os.Lstat(path)
	if err != nil {
		return result, err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > 512<<20 {
		return result, errors.New("runtime 准备文件类型或大小无效")
	}
	file, err := os.Open(path)
	if err != nil {
		return result, err
	}
	defer file.Close()
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(file, info.Size()+1))
	if err != nil || n != info.Size() {
		return result, errors.New("runtime 准备文件读取不完整")
	}
	return lifecycle.RuntimeFile{SHA256: hex.EncodeToString(hash.Sum(nil)), Size: n}, nil
}
func copyRuntimeEngine(source, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0755)
	if err != nil {
		return err
	}
	defer output.Close()
	if _, err := io.Copy(output, input); err != nil {
		return err
	}
	return output.Sync()
}
func (d *Driver) cleanupRuntimeHelpers(ctx context.Context, s lifecycle.Spec) error {
	filter, _ := json.Marshal(map[string][]string{"label": {ownerLabel + "=" + runtimeHelperOwner, "io.monkeyai.environment=" + s.EnvironmentID}})
	var containers []struct {
		ID string `json:"Id"`
	}
	if err := d.client.Do(ctx, "GET", "/containers/json?all=true&filters="+url.QueryEscape(string(filter)), nil, &containers); err != nil {
		return err
	}
	for _, container := range containers {
		if err := d.client.Do(ctx, "DELETE", "/containers/"+dockerapi.Escape(container.ID)+"?force=true", nil, nil); err != nil && !dockerapi.NotFound(err) {
			return err
		}
	}
	return nil
}
func (d *Driver) runtimeHelper(ctx context.Context, s lifecycle.Spec, payload, command string, consume func(string) error) (result error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	image, err := d.image(ctx, s)
	if err != nil {
		return err
	}
	cfg := Config{Image: image.ID, User: "0:0", WorkingDir: "/tmp", Entrypoint: []string{"/bin/sh", "-ec"}, Cmd: []string{command}, Labels: map[string]string{ownerLabel: runtimeHelperOwner, "io.monkeyai.environment": s.EnvironmentID}}
	for _, value := range image.Config.Env {
		key, _, ok := strings.Cut(value, "=")
		if ok && key != "PATH" && key != "HOME" && key != "USER" && key != "LOGNAME" && key != "LANG" {
			cfg.Env = append(cfg.Env, key+"=")
		}
	}
	cfg.Env = append(cfg.Env, "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HOME=/root", "USER=root", "LOGNAME=root", "LANG=C.UTF-8")
	cfg.Healthcheck.Test = []string{"NONE"}
	host := HostConfig{Runtime: dockerapi.Runtime, NetworkMode: "none", CgroupnsMode: "private", IpcMode: "private", CapDrop: []string{"ALL"}, CapAdd: []string{"CHOWN", "DAC_OVERRIDE", "FOWNER", "SETUID", "SETGID"}, SecurityOpt: []string{"no-new-privileges:true"}, Memory: 1 << 30, MemorySwap: 1 << 30, NanoCpus: 2e9, PidsLimit: 256, ShmSize: 16 << 20, Ulimits: []Ulimit{{"nofile", 4096, 4096}, {"nproc", 512, 512}}}
	host.RestartPolicy.Name = "no"
	host.LogConfig.Type = "json-file"
	host.LogConfig.Config = map[string]string{"max-size": "1m", "max-file": "1"}
	var created struct {
		ID string `json:"Id"`
	}
	if err := d.client.Do(ctx, "POST", "/containers/create", createBody{Config: cfg, HostConfig: host}, &created); err != nil {
		return err
	}
	if created.ID == "" {
		return errors.New("runtime 准备容器没有返回 ID")
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		defer stop()
		err := d.client.Do(cleanup, "DELETE", "/containers/"+dockerapi.Escape(created.ID)+"?force=true", nil, nil)
		if err != nil && !dockerapi.NotFound(err) {
			result = errors.Join(result, err)
		}
	}()
	if err := d.runtimePayload(ctx, created.ID, payload); err != nil {
		return err
	}
	if err := d.client.Do(ctx, "POST", "/containers/"+dockerapi.Escape(created.ID)+"/start", nil, nil); err != nil {
		return err
	}
	var exit struct {
		StatusCode int64
		Error      *struct{ Message string }
	}
	if err := d.client.Do(ctx, "POST", "/containers/"+dockerapi.Escape(created.ID)+"/wait?condition=not-running", nil, &exit); err != nil {
		return err
	}
	if exit.StatusCode != 0 || exit.Error != nil {
		return fmt.Errorf("runtime 隔离准备失败，退出码 %d", exit.StatusCode)
	}
	return consume(created.ID)
}
func (d *Driver) runtimePayload(ctx context.Context, id, path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	reader, writer := io.Pipe()
	defer reader.Close()
	go func() {
		archive := tar.NewWriter(writer)
		err := archive.WriteHeader(&tar.Header{Name: "monkeyai-runtime", Mode: 0755, Size: info.Size(), Typeflag: tar.TypeReg})
		if err == nil {
			var file *os.File
			file, err = os.Open(path)
			if err == nil {
				_, err = io.Copy(archive, file)
				file.Close()
			}
		}
		if err == nil {
			err = archive.Close()
		}
		writer.CloseWithError(err)
	}()
	return d.client.Do(ctx, "PUT", "/containers/"+dockerapi.Escape(id)+"/archive?path=/tmp", reader, nil)
}
func (d *Driver) runtimeArtifact(ctx context.Context, id, source, destination string, limit int64) error {
	stream, err := d.client.Stream(ctx, "GET", "/containers/"+dockerapi.Escape(id)+"/archive?path="+url.QueryEscape(source), nil)
	if err != nil {
		return err
	}
	defer stream.Close()
	archive := tar.NewReader(io.LimitReader(stream, limit+(1<<20)))
	header, err := archive.Next()
	if err != nil {
		return err
	}
	if header.Name != filepath.Base(source) || (header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA) || header.Size < 1 || header.Size > limit {
		return errors.New("runtime 准备容器返回无效文件")
	}
	file, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	defer file.Close()
	if n, err := io.Copy(file, archive); err != nil || n != header.Size {
		return errors.New("runtime 准备文件读取不完整")
	}
	if _, err := archive.Next(); err != io.EOF {
		return errors.New("runtime 准备容器返回额外文件")
	}
	return file.Sync()
}
