package guest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func prepareRuntime(ctx context.Context, payload, destination string, release lifecycle.RuntimePackage, _ []string) (lifecycle.RuntimePackage, error) {
	if release.Validate() != nil || !release.SingleFile() || release.Architecture != runtime.GOARCH {
		return release, errors.New("runtime准备需要固定摘要单文件")
	}
	if err := os.Chmod(payload, 0755); err != nil {
		return release, err
	}
	capture := func(args ...string) ([]byte, error) {
		cmd := exec.CommandContext(ctx, payload, args...)
		cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "HOME=/root", "LANG=C.UTF-8"}
		var out boundedArtifact
		cmd.Stdout = &out
		if err := cmd.Run(); err != nil {
			return nil, errors.New("runtime内嵌资源提取失败")
		}
		if out.exceeded {
			return nil, errors.New("runtime内嵌资源超过上限")
		}
		return out.data, nil
	}
	metadata, err := capture("bundle-info")
	if err != nil {
		return release, err
	}
	var info struct {
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
	if len(metadata) > 16<<10 || json.Unmarshal(metadata, &info) != nil || info.Schema != 1 || info.Development || info.Version != release.Version || info.OS != "linux" || info.Arch != release.Architecture || info.RuntimeRevision != release.RuntimeRevision || info.EngineRevision != release.EngineRevision || info.EngineSize <= 0 || info.EngineSize > 512<<20 || len(info.EngineSHA256) != 64 || strings.Trim(info.EngineSHA256, "0123456789abcdef") != "" {
		return release, errors.New("runtime内嵌发行信息不一致")
	}
	notices, err := capture("licenses")
	if err != nil {
		return release, err
	}
	hash := sha256.Sum256(notices)
	if hex.EncodeToString(hash[:]) != info.LicenseSHA256 {
		return release, errors.New("runtime授权材料摘要不一致")
	}
	engine, cleanup, err := releaseRuntime(ctx, payload, release.Version, release.Files["monkeyai-runtime"].SHA256)
	if err != nil {
		return release, err
	}
	defer cleanup()
	source, err := os.Open(engine)
	if err != nil {
		return release, err
	}
	defer source.Close()
	target, err := os.OpenFile(filepath.Join(destination, "ohmyagent"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0755)
	if err != nil {
		return release, err
	}
	sum := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(target, sum), io.LimitReader(source, info.EngineSize+1))
	if err := errors.Join(copyErr, target.Chmod(0755), target.Sync(), target.Close()); err != nil {
		return release, err
	}
	if n != info.EngineSize || hex.EncodeToString(sum.Sum(nil)) != info.EngineSHA256 {
		return release, errors.New("runtime释放引擎摘要不一致")
	}
	release.Files = maps.Clone(release.Files)
	release.Files["ohmyagent"] = lifecycle.RuntimeFile{SHA256: info.EngineSHA256, Size: n}
	for name, data := range map[string][]byte{"LICENSES.txt": notices, "bundle.json": metadata} {
		path := filepath.Join(destination, name)
		if err := os.WriteFile(path, data, 0644); err != nil {
			return release, err
		}
		if err := os.Chmod(path, 0644); err != nil {
			return release, err
		}
		hash := sha256.Sum256(data)
		release.Files[name] = lifecycle.RuntimeFile{SHA256: hex.EncodeToString(hash[:]), Size: int64(len(data))}
	}
	return release, nil
}

type boundedArtifact struct {
	data     []byte
	exceeded bool
}

func (b *boundedArtifact) Write(p []byte) (int, error) {
	n := len(p)
	left := (8 << 20) - len(b.data)
	if len(p) > left {
		b.exceeded = true
		p = p[:left]
	}
	b.data = append(b.data, p...)
	return n, nil
}
func maintenanceMode() bool {
	raw, err := os.ReadFile("/proc/cmdline")
	if err != nil {
		return false
	}
	for _, field := range strings.Fields(string(raw)) {
		if field == "monkeyai.maintenance=1" {
			return true
		}
	}
	return false
}
