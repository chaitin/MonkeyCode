package lifecycle

import (
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"regexp"
	"strings"
)

var identifier = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`)
var imageDigest = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
var imageName = regexp.MustCompile(`^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$`)

type DesiredState string

const (
	DesiredRunning DesiredState = "running"
	DesiredStopped DesiredState = "stopped"
	DesiredDeleted DesiredState = "deleted"
)

type Phase string

const (
	PhasePending   Phase = "pending"
	PhasePreparing Phase = "preparing"
	PhaseStarting  Phase = "starting"
	PhaseRunning   Phase = "running"
	PhaseStopping  Phase = "stopping"
	PhaseStopped   Phase = "stopped"
	PhaseFailed    Phase = "failed"
	PhaseDeleting  Phase = "deleting"
	PhaseDeleted   Phase = "deleted"
)

// Spec 不允许传入宿主路径、任意挂载或底层运行时参数。
type Runtime struct {
	Server   string `json:"server"`
	ServerID string `json:"server_id"`
	UserID   string `json:"user_id"`
}
type Spec struct {
	Runtime       *Runtime     `json:"runtime,omitempty"`
	EnvironmentID string       `json:"environment_id"`
	InstanceID    string       `json:"instance_id"`
	Generation    int64        `json:"generation"`
	DesiredState  DesiredState `json:"desired_state"`
	Driver        string       `json:"driver"`
	Image         string       `json:"image"`
	ImageDigest   string       `json:"image_digest"`
	Resource      Resource     `json:"resource"`
	Volumes       []Volume     `json:"volumes"`
	NetworkPolicy string       `json:"network_policy"`
}

type Resource struct {
	CPUMillis      int64 `json:"cpu_millis"`
	MemoryBytes    int64 `json:"memory_bytes"`
	HostTasks      int64 `json:"host_tasks"`
	TemporaryBytes int64 `json:"temporary_bytes"`
}
type Volume struct {
	ID      string `json:"id"`
	Purpose string `json:"purpose"`
	Bytes   int64  `json:"bytes"`
	Inodes  int64  `json:"inodes"`
}

func (v Volume) Target() string {
	switch v.Purpose {
	case "workspace":
		return "/workspace"
	case "home":
		return "/home/monkey"
	case "runtime":
		return "/var/lib/monkeyai"
	}
	return ""
}
func (s Spec) Validate() error {
	if !identifier.MatchString(s.EnvironmentID) || !identifier.MatchString(s.InstanceID) {
		return errors.New("环境或实例标识无效")
	}
	if s.Generation < 1 {
		return errors.New("配置代次必须为正数")
	}
	if s.DesiredState != DesiredRunning && s.DesiredState != DesiredStopped && s.DesiredState != DesiredDeleted {
		return errors.New("目标状态无效")
	}
	if s.Driver != "gvisor" {
		return errors.New("不支持的执行驱动")
	}
	if !imageDigest.MatchString(s.ImageDigest) || !imageName.MatchString(s.Image) || !strings.HasSuffix(s.Image, "@"+s.ImageDigest) || len(s.Image) > 512 {
		return errors.New("镜像必须使用一致的仓库引用和固定 sha256 摘要")
	}
	if s.Runtime != nil {
		u, err := url.Parse(s.Runtime.Server)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.ForceQuery || !identifier.MatchString(s.Runtime.UserID) || !identifier.MatchString(s.Runtime.ServerID) || s.NetworkPolicy != "public-only" {
			return errors.New("运行时身份或后台网络配置无效")
		}
	}
	r := s.Resource
	if r.CPUMillis < 100 || r.CPUMillis > 256000 || r.MemoryBytes < 256<<20 || r.MemoryBytes > 1<<40 || r.HostTasks < 64 || r.HostTasks > 65536 || r.TemporaryBytes < 16<<20 || r.TemporaryBytes > r.MemoryBytes/2 || r.TemporaryBytes%4096 != 0 {
		return errors.New("资源规格无效")
	}
	if s.NetworkPolicy != "isolated" && s.NetworkPolicy != "public-only" {
		return errors.New("不支持的网络策略")
	}
	if len(s.Volumes) != 3 {
		return errors.New("需要项目、用户和运行时三个持久卷")
	}
	ids, purposes := map[string]bool{}, map[string]bool{}
	for _, v := range s.Volumes {
		if !identifier.MatchString(v.ID) || ids[v.ID] || v.Target() == "" || purposes[v.Purpose] || v.Bytes < 64<<20 || v.Bytes > 16<<40 || v.Bytes%1024 != 0 || v.Inodes < 1024 || v.Inodes > 100000000 {
			return errors.New("持久卷标识、用途或配额无效")
		}
		ids[v.ID], purposes[v.Purpose] = true, true
	}
	return nil
}
func Decode(r io.Reader) (Spec, error) {
	raw, err := io.ReadAll(io.LimitReader(r, (64<<10)+1))
	if err != nil {
		return Spec{}, err
	}
	if len(raw) > 64<<10 {
		return Spec{}, errors.New("环境规格超过 64 KiB")
	}
	if err := fields(json.NewDecoder(strings.NewReader(string(raw)))); err != nil {
		return Spec{}, err
	}
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	var s Spec
	if err := d.Decode(&s); err != nil {
		return s, err
	}
	if d.Decode(new(any)) != io.EOF {
		return s, errors.New("规格必须只包含一个 JSON 对象")
	}
	return s, s.Validate()
}
