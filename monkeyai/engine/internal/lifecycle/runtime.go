package lifecycle

import (
	"errors"
	"regexp"
	"strings"
)

var runtimeVersion = regexp.MustCompile(`^[0-9]{1,8}\.[0-9]{1,8}\.[0-9]{1,8}$`)
var runtimeSHA = regexp.MustCompile(`^[a-f0-9]{64}$`)

type RuntimeFile struct {
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type RuntimePackage struct {
	RuntimeRevision string                 `json:"runtime_revision,omitempty"`
	EngineRevision  string                 `json:"engine_revision,omitempty"`
	Version         string                 `json:"version"`
	Architecture    string                 `json:"architecture"`
	Files           map[string]RuntimeFile `json:"files"`
}

func ValidRuntimeVersion(value string) bool { return runtimeVersion.MatchString(value) }

func (p RuntimePackage) SingleFile() bool { return len(p.Files) == 1 }
func (p RuntimePackage) Validate() error {
	if !ValidRuntimeVersion(p.Version) || (p.Architecture != "amd64" && p.Architecture != "arm64") || (len(p.Files) != 4 && !p.SingleFile()) {
		return errors.New("runtime 发行版本或架构无效")
	}
	names := []string{"monkeyai-runtime", "ohmyagent", "LICENSES.txt", "bundle.json"}
	if p.SingleFile() {
		names = names[:1]
	}
	if p.SingleFile() || p.RuntimeRevision != "" || p.EngineRevision != "" {
		for _, revision := range []string{p.RuntimeRevision, p.EngineRevision} {
			if len(revision) != 40 || strings.Trim(revision, "0123456789abcdef") != "" {
				return errors.New("runtime 源码修订无效")
			}
		}
	}
	for _, name := range names {
		file, ok := p.Files[name]
		limit := int64(512 << 20)
		if name == "bundle.json" {
			limit = 16 << 10
		}
		if name == "LICENSES.txt" {
			limit = 8 << 20
		}
		if !ok || !runtimeSHA.MatchString(file.SHA256) || file.Size <= 0 || file.Size > limit {
			return errors.New("runtime 发行文件缺失或校验值无效")
		}
	}
	return nil
}
