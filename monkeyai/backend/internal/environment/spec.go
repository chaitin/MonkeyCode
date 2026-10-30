package environment

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

var uuid = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
var image = regexp.MustCompile(`^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$`)
var key = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`)

type Resources struct {
	CPUMillis      int64 `json:"cpu_millis"`
	MemoryBytes    int64 `json:"memory_bytes"`
	HostTasks      int64 `json:"host_tasks"`
	TemporaryBytes int64 `json:"temporary_bytes"`
}
type Storage struct {
	WorkspaceBytes int64 `json:"workspace_bytes"`
	HomeBytes      int64 `json:"home_bytes"`
	RuntimeBytes   int64 `json:"runtime_bytes"`
	Inodes         int64 `json:"inodes"`
}

func (s Storage) Bytes() int64 { return s.WorkspaceBytes + s.HomeBytes + s.RuntimeBytes }

type Profile struct {
	Architecture  string    `json:"architecture"`
	Image         string    `json:"image"`
	NetworkPolicy string    `json:"network_policy"`
	Resource      Resources `json:"resource"`
	Storage       Storage   `json:"storage"`
}

func (p Profile) Validate() error {
	if (p.Architecture != "amd64" && p.Architecture != "arm64") || !image.MatchString(p.Image) || len(p.Image) > 512 || (p.NetworkPolicy != "isolated" && p.NetworkPolicy != "public-only") {
		return errors.New("架构、固定摘要镜像或网络策略无效")
	}
	r := p.Resource
	if r.CPUMillis < 100 || r.CPUMillis > 256000 || r.MemoryBytes < 256<<20 || r.MemoryBytes > 1<<40 || r.HostTasks < 64 || r.HostTasks > 65536 || r.TemporaryBytes < 16<<20 || r.TemporaryBytes > r.MemoryBytes/2 || r.TemporaryBytes%4096 != 0 {
		return errors.New("资源规格无效")
	}
	for _, b := range []int64{p.Storage.WorkspaceBytes, p.Storage.HomeBytes, p.Storage.RuntimeBytes} {
		if b < 64<<20 || b > 16<<40 || b%1024 != 0 {
			return errors.New("卷容量无效")
		}
	}
	if p.Storage.Inodes < 1024 || p.Storage.Inodes > 100000000 {
		return errors.New("卷 inode 配额无效")
	}
	return nil
}

type Volume struct {
	ID      string `json:"id"`
	Purpose string `json:"purpose"`
	Bytes   int64  `json:"bytes"`
	Inodes  int64  `json:"inodes"`
}

// 与 engine 的规范化规格对应，协议只传资源语义，不传宿主路径。
type Runtime struct {
	Server   string `json:"server"`
	ServerID string `json:"server_id"`
	UserID   string `json:"user_id"`
}
type Spec struct {
	Runtime       *Runtime  `json:"runtime,omitempty"`
	EnvironmentID string    `json:"environment_id"`
	InstanceID    string    `json:"instance_id"`
	Generation    int64     `json:"generation"`
	DesiredState  string    `json:"desired_state"`
	Driver        string    `json:"driver"`
	Image         string    `json:"image"`
	ImageDigest   string    `json:"image_digest"`
	Resource      Resources `json:"resource"`
	Volumes       []Volume  `json:"volumes"`
	NetworkPolicy string    `json:"network_policy"`
}

func (p Profile) Spec(id string) Spec {
	digest := p.Image[strings.LastIndexByte(p.Image, '@')+1:]
	return Spec{EnvironmentID: id, InstanceID: resource.ID(), Generation: 1, DesiredState: "running", Driver: "gvisor", Image: p.Image, ImageDigest: digest, Resource: p.Resource, NetworkPolicy: p.NetworkPolicy, Volumes: []Volume{{resource.ID(), "workspace", p.Storage.WorkspaceBytes, p.Storage.Inodes}, {resource.ID(), "home", p.Storage.HomeBytes, p.Storage.Inodes}, {resource.ID(), "runtime", p.Storage.RuntimeBytes, p.Storage.Inodes}}}
}
func hash(v any) string {
	b, _ := json.Marshal(v)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
func validName(v string) bool {
	return len(v) > 0 && len(v) <= 128 && v == strings.TrimSpace(v) && !strings.ContainsAny(v, "\x00\r\n\t")
}
