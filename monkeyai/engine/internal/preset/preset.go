package preset

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"regexp"
	"strings"
)

const MaxSize = 64 << 10

type Resources struct {
	CPUMillis      int64 `json:"cpu_millis"`
	MemoryBytes    int64 `json:"memory_bytes"`
	WorkspaceBytes int64 `json:"workspace_bytes"`
	HomeBytes      int64 `json:"home_bytes"`
	RuntimeBytes   int64 `json:"runtime_bytes"`
	VolumeInodes   int64 `json:"volume_inodes"`
	TemporaryBytes int64 `json:"temporary_bytes"`
	SandboxTasks   int64 `json:"sandbox_tasks"`
}

type Artifact struct {
	Path    string `json:"path"`
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
}

type Preset struct {
	Version       int       `json:"version"`
	ID            string    `json:"id"`
	Revision      int64     `json:"revision"`
	Name          string    `json:"name"`
	Image         string    `json:"image"`
	Architecture  string    `json:"architecture"`
	Driver        string    `json:"driver"`
	NetworkPolicy string    `json:"network_policy"`
	Runtime       Artifact  `json:"runtime"`
	TaskEngine    Artifact  `json:"task_engine"`
	Resources     Resources `json:"resources"`
}

var (
	identifier = regexp.MustCompile(`^[a-z][a-z0-9-]{0,62}$`)
	digest     = regexp.MustCompile(`^[a-f0-9]{64}$`)
	imageName  = regexp.MustCompile(`^[a-z0-9][a-z0-9._:/-]*$`)
	fieldName  = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
)

func Decode(r io.Reader) (Preset, error) {
	data, err := io.ReadAll(io.LimitReader(r, MaxSize+1))
	if err != nil {
		return Preset{}, err
	}
	if len(data) > MaxSize {
		return Preset{}, errors.New("预设超过 64 KiB")
	}
	if err := uniqueFields(json.NewDecoder(bytes.NewReader(data))); err != nil {
		return Preset{}, err
	}
	var p Preset
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(&p); err != nil {
		return Preset{}, errors.New("预设字段或类型无效")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return Preset{}, errors.New("预设必须只包含一个 JSON 对象")
	}
	return p, p.Validate()
}

// JSON 重复字段会导致签发端和执行端使用不同规格，必须在解析为结构体前拒绝。
func uniqueFields(d *json.Decoder) error {
	t, err := d.Token()
	if err != nil {
		return errors.New("预设 JSON 无效")
	}
	switch t {
	case json.Delim('{'):
		seen := map[string]bool{}
		for d.More() {
			key, err := d.Token()
			if err != nil {
				return errors.New("预设 JSON 无效")
			}
			name, ok := key.(string)
			if !ok || !fieldName.MatchString(name) || seen[name] {
				return errors.New("预设包含重复字段或非规范字段名")
			}
			seen[name] = true
			if err := uniqueFields(d); err != nil {
				return err
			}
		}
		if _, err := d.Token(); err != nil {
			return errors.New("预设 JSON 无效")
		}
	case json.Delim('['):
		for d.More() {
			if err := uniqueFields(d); err != nil {
				return err
			}
		}
		if _, err := d.Token(); err != nil {
			return errors.New("预设 JSON 无效")
		}
	}
	return nil
}

func (p Preset) Validate() error {
	if p.Version != 1 {
		return errors.New("不支持的预设协议版本")
	}
	if !identifier.MatchString(p.ID) || p.Revision < 1 {
		return errors.New("预设标识或修订无效")
	}
	if p.Name == "" || len(p.Name) > 128 || strings.TrimSpace(p.Name) != p.Name || strings.ContainsAny(p.Name, "\x00\r\n\t") {
		return errors.New("预设名称无效")
	}
	if p.Driver != "gvisor" {
		return errors.New("首期只支持 gvisor，不允许降级为普通容器")
	}
	if p.Architecture != "amd64" && p.Architecture != "arm64" {
		return errors.New("不支持的镜像架构")
	}
	name, hash, ok := strings.Cut(p.Image, "@sha256:")
	if !ok || !digest.MatchString(hash) || len(name) > 255 || !imageName.MatchString(name) || strings.Contains(name, "..") || !strings.Contains(name, "/") {
		return errors.New("镜像必须包含仓库路径和固定的 sha256 摘要")
	}
	if !identifier.MatchString(p.NetworkPolicy) {
		return errors.New("必须指定由宿主管理的网络策略")
	}
	for name, a := range map[string]Artifact{"runtime": p.Runtime, "task_engine": p.TaskEngine} {
		if a.Path == "/opt/monkeyai" || !strings.HasPrefix(a.Path, "/opt/monkeyai/") || path.Clean(a.Path) != a.Path || strings.ContainsAny(a.Path, "\x00\r\n\t ") || !digest.MatchString(a.SHA256) || a.Version == "" || a.Version == "latest" || len(a.Version) > 128 || strings.ContainsAny(a.Version, "\x00\r\n\t ") {
			return fmt.Errorf("%s 必须指定只读发行目录内的路径、固定版本和 SHA-256", name)
		}
	}
	if p.Runtime.Path == p.TaskEngine.Path {
		return errors.New("runtime 与任务引擎不能使用同一路径")
	}
	r := p.Resources
	if r.CPUMillis < 100 || r.CPUMillis > 256000 {
		return errors.New("CPU 必须在 100 至 256000 毫核之间")
	}
	if r.MemoryBytes < 256<<20 || r.MemoryBytes > 1<<40 {
		return errors.New("内存必须在 256 MiB 至 1 TiB 之间")
	}
	for _, size := range []int64{r.WorkspaceBytes, r.HomeBytes, r.RuntimeBytes} {
		if size < 64<<20 || size > 16<<40 {
			return errors.New("持久卷必须在 64 MiB 至 16 TiB 之间")
		}
	}
	if r.VolumeInodes < 1024 || r.VolumeInodes > 100000000 {
		return errors.New("每卷 inode 配额无效")
	}
	if r.TemporaryBytes < 1<<20 || r.TemporaryBytes > r.MemoryBytes/2 {
		return errors.New("临时目录总量必须在 1 MiB 至环境内存的一半之间")
	}
	if r.SandboxTasks < 32 || r.SandboxTasks > 65536 {
		return errors.New("沙箱内任务数必须在 32 至 65536 之间")
	}
	return nil
}

func (r Resources) StorageBytes() int64 { return r.WorkspaceBytes + r.HomeBytes + r.RuntimeBytes }

func (r Resources) CPUQuota() (quota, period int64) { return r.CPUMillis * 100, 100000 }
