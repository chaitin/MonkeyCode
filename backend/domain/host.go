package domain

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	etypes "github.com/chaitin/MonkeyCode/backend/ent/types"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// HostUsecase 主机业务逻辑接口
type HostUsecase interface {
	GetInstallCommand(ctx context.Context, user *User) (string, error)
	InstallScript(ctx context.Context, token *InstallReq) (string, error)
	List(ctx context.Context, uid uuid.UUID) (*HostListResp, error)
	VMInfo(ctx context.Context, uid uuid.UUID, id string) (*VirtualMachine, error)
	ConnectVMTerminal(ctx context.Context, uid uuid.UUID, req TerminalReq) (taskflow.Sheller, error)
	TerminalList(ctx context.Context, id string) ([]*Terminal, error)
	CloseTerminal(ctx context.Context, id, terminalID string) error
	ShareTerminal(ctx context.Context, user *User, req *ShareTerminalReq) (*ShareTerminalResp, error)
	JoinTerminal(ctx context.Context, req *JoinTerminalReq) (taskflow.Sheller, *SharedTerminal, error)
	WithVMPermission(ctx context.Context, uid uuid.UUID, id string, fn func(*VirtualMachine) error) error
	CreateVM(ctx context.Context, user *User, req *CreateVMReq) (*VirtualMachine, error)
	DeleteVM(ctx context.Context, uid uuid.UUID, hostID, vmID string) error
	DeleteHost(ctx context.Context, uid uuid.UUID, id string) error
	UpdateHost(ctx context.Context, uid uuid.UUID, req *UpdateHostReq) error
	RefreshIdleTimers(ctx context.Context, vmID string) error
	FireExpiredVM(ctx context.Context, fire bool) ([]FireExpiredVMItem, error)
	UpdateVM(ctx context.Context, req UpdateVMReq) (*VirtualMachine, error)
	ApplyPort(ctx context.Context, uid uuid.UUID, req *ApplyPortReq) (*VMPort, error)
	RecyclePort(ctx context.Context, uid uuid.UUID, req *RecyclePortReq) error
}

// HostRepo 主机数据访问接口
type HostRepo interface {
	List(ctx context.Context, uid uuid.UUID) ([]*db.Host, error)
	GetHost(ctx context.Context, uid uuid.UUID, id string) (*Host, error)
	GetByID(ctx context.Context, id string) (*db.Host, error)
	GetVirtualMachine(ctx context.Context, id string) (*db.VirtualMachine, error)
	GetVirtualMachineByEnvID(ctx context.Context, envID string) (*db.VirtualMachine, error)
	GetVirtualMachineWithUser(ctx context.Context, uid uuid.UUID, id string) (*db.VirtualMachine, error)
	CreateVirtualMachine(ctx context.Context, user *User, req *CreateVMReq, getRepoToken func(context.Context) (string, error), fn func(*db.Model, *db.Image) (*VirtualMachine, error)) (*VirtualMachine, error)
	PastHourVirtualMachine(ctx context.Context) ([]*db.VirtualMachine, error)
	AllCountDownVirtualMachine(ctx context.Context) ([]*db.VirtualMachine, error)
	DeleteVirtualMachine(ctx context.Context, uid uuid.UUID, hostID, id string, fn func(*db.VirtualMachine) error) error
	UpsertVirtualMachine(ctx context.Context, vm *taskflow.VirtualMachine) error
	UpdateVirtualMachine(ctx context.Context, id string, fn func(*db.VirtualMachineUpdateOne) error) error
	UpsertHost(ctx context.Context, h *taskflow.Host) error
	DeleteHost(ctx context.Context, uid uuid.UUID, id string) error
	UpdateHost(ctx context.Context, uid uuid.UUID, req *UpdateHostReq) error
	UpdateVM(ctx context.Context, req UpdateVMReq, fn func(*db.VirtualMachine) error) (*db.VirtualMachine, int64, error)
}

// VmIdleInfo 空闲队列 payload（任务创建的 VM）
type VmIdleInfo struct {
	UID    uuid.UUID `json:"uid"`
	VmID   string    `json:"vm_id"`
	HostID string    `json:"host_id"`
	EnvID  string    `json:"env_id"`
	TaskID string    `json:"task_id,omitempty"` // 关联的任务 ID，用于通知
	Name   string    `json:"name,omitempty"`    // 任务名称，用于通知内容
}

// VmExpireInfo VM 过期信息（手动创建的 VM）
type VmExpireInfo struct {
	UID    uuid.UUID `json:"uid"`
	VmID   string    `json:"vm_id"`
	HostID string    `json:"host_id"`
	EnvID  string    `json:"env_id"`
}

// InstallReq 安装请求
type InstallReq struct {
	Token string `json:"token" query:"token"`
}

// InstallCommand 安装命令
type InstallCommand struct {
	Command string `json:"command"`
}

// DeleteVirtualMachineReq 删除虚拟机请求
type DeleteVirtualMachineReq struct {
	ID     string `json:"id" query:"id" param:"id" validate:"required"`
	HostID string `json:"host_id" query:"host_id" param:"host_id" validate:"required"`
}

// VMTerminalMessageType WebSocket 消息类型
type VMTerminalMessageType string

const (
	VMTerminalMessageTypeData      VMTerminalMessageType = "data"
	VMTerminalMessageTypeControl   VMTerminalMessageType = "control"
	VMTerminalMessageTypeError     VMTerminalMessageType = "error"
	VMTerminalMessageTypeResize    VMTerminalMessageType = "resize"
	VMTerminalMessageTypePing      VMTerminalMessageType = "ping"
	VMTerminalMessageTypePong      VMTerminalMessageType = "pong"
	VMTerminalMessageTypeConnected VMTerminalMessageType = "connected"
)

// VMTerminalMessage WebSocket 消息结构
type VMTerminalMessage struct {
	Type VMTerminalMessageType `json:"type"`
	Data string                `json:"data"`
}

// VMTerminalSuccess 连接成功信息
type VMTerminalSuccess struct {
	Username  string `json:"username"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}

// VMTerminalResizeData 调整终端大小的数据
type VMTerminalResizeData struct {
	Col int `json:"col"`
	Row int `json:"row"`
}

// VirtualMachine 虚拟机
type VirtualMachine struct {
	ID              string                        `json:"id"`
	Hostname        string                        `json:"hostname"`
	OS              string                        `json:"os"`
	Cores           int32                         `json:"cores"`
	Memory          uint64                        `json:"memory"`
	Status          taskflow.VirtualMachineStatus `json:"status"`
	Name            string                        `json:"name"`
	LifeTimeSeconds int64                         `json:"life_time_seconds"`
	Host            *Host                         `json:"host,omitempty"`
	Version         string                        `json:"version"`
	CreatedAt       int64                         `json:"created_at"`
	EnvironmentID   string                        `json:"environment_id,omitempty"`
	Owner           *User                         `json:"owner,omitempty"`
	Conditions      []*etypes.Condition           `json:"conditions"`
	Ports           []*VMPort                     `json:"ports,omitempty"`
}

// From 从数据库模型转换
func (v *VirtualMachine) From(vm *db.VirtualMachine) *VirtualMachine {
	if vm == nil {
		return v
	}

	v.ID = vm.ID
	v.Hostname = vm.Hostname
	v.OS = vm.Os
	v.Cores = int32(vm.Cores)
	v.Memory = uint64(vm.Memory)
	v.Name = vm.Name
	v.Version = vm.Version
	v.CreatedAt = vm.CreatedAt.Unix()

	if vm.Conditions != nil {
		v.Conditions = vm.Conditions.Conditions
		if v.Status != taskflow.VirtualMachineStatusOnline {
			v.Status = taskflow.VirtualMachineStatusPending
			for _, cond := range vm.Conditions.Conditions {
				switch cond.Type {
				case etypes.ConditionTypeFailed:
					v.Status = taskflow.VirtualMachineStatusOffline
				case etypes.ConditionTypeReady:
					if time.Since(time.UnixMilli(cond.LastTransitionTime)) > 3*time.Minute {
						v.Status = taskflow.VirtualMachineStatusOffline
					}
				}
			}
		}
	}

	switch vm.TTLKind {
	case consts.CountDown:
		v.LifeTimeSeconds = vm.TTL - (time.Now().Unix() - vm.CreatedAt.Unix())
	case consts.Forever:
		v.LifeTimeSeconds = 0
	}
	if vm.Edges.Host != nil {
		v.Host = cvt.From(vm.Edges.Host, &Host{})
	}
	if vm.Edges.User != nil {
		v.Owner = cvt.From(vm.Edges.User, &User{})
	}
	return v
}

// Host 宿主机
type Host struct {
	ID              string            `json:"id"`
	Arch            string            `json:"arch"`
	Cores           int               `json:"cores"`
	OS              string            `json:"os"`
	Status          consts.HostStatus `json:"status"`
	Memory          uint64            `json:"memory"`
	Name            string            `json:"name"`
	ExternalIP      string            `json:"external_ip"`
	Default         bool              `json:"default"`
	Version         string            `json:"version"`
	VirtualMachines []*VirtualMachine `json:"virtualmachines,omitempty"`
	IsDefault       bool              `json:"is_default"`
	Owner           *Owner            `json:"owner,omitempty"`
	Groups          []*TeamGroup      `json:"groups,omitempty"`
	Remark          string            `json:"remark,omitempty"`
	Weight          int               `json:"weight"`
}

// From 从数据库模型转换
func (h *Host) From(e *db.Host) *Host {
	if e == nil {
		return h
	}

	h.ID = e.ID
	h.Arch = e.Arch
	h.OS = e.Os
	h.Cores = e.Cores
	h.Memory = uint64(e.Memory)
	h.Name = e.Hostname
	h.ExternalIP = e.ExternalIP
	h.Version = e.Version
	h.VirtualMachines = cvt.Iter(e.Edges.Vms, func(_ int, v *db.VirtualMachine) *VirtualMachine {
		return cvt.From(v, &VirtualMachine{})
	})
	h.Remark = e.Remark
	h.Weight = e.Weight
	if h.Weight <= 0 {
		h.Weight = 1
	}

	if user := e.Edges.User; user != nil {
		if user.Role == consts.UserRoleAdmin {
			ls := strings.Split(h.ID, "-")
			h.ID = "public_host"
			if len(ls) > 3 {
				h.ID = h.ID + "_" + strings.Join(ls[:3], "_")
			}
			h.Name = "MonkeyCode-AI"
			h.ExternalIP = ""
			return h
		}

		h.Owner = &Owner{
			ID:   user.ID.String(),
			Type: consts.OwnerTypePrivate,
			Name: user.Name,
		}
	}

	if gs := e.Edges.Groups; len(gs) > 0 {
		h.Groups = cvt.Iter(gs, func(_ int, g *db.TeamGroup) *TeamGroup {
			return cvt.From(g, &TeamGroup{})
		})

		g := gs[0]
		if team := g.Edges.Team; team != nil {
			h.Owner = &Owner{
				ID:   team.ID.String(),
				Type: consts.OwnerTypeTeam,
				Name: team.Name,
			}
		}
	}

	return h
}

// GetIsDefault 获取是否为默认主机
func (h *Host) GetIsDefault(user *db.User) bool {
	if defaultHostID, ok := user.DefaultConfigs[consts.DefaultConfigTypeHost]; ok {
		if defaultHostID.String() == h.ID {
			return true
		}
	}
	return false
}

// HostListResp 主机列表响应
type HostListResp struct {
	Hosts []*Host `json:"hosts"`
}

// Resource 资源配置
type Resource struct {
	CPU    int   `json:"cpu"`
	Memory int64 `json:"memory"`
}

// ModelConfig 模型配置
type ModelConfig struct {
	URL  string `json:"url"`
	Key  string `json:"key"`
	Name string `json:"name"`
}

// TaskRepoReq 仓库请求
type TaskRepoReq struct {
	RepoURL      string `json:"repo_url"`
	Branch       string `json:"branch"`
	RepoFilename string `json:"repo_filename"`
	ZipURL       string `json:"zip_url"`
}

// CreateVMReq 创建虚拟机请求
type CreateVMReq struct {
	HostID              string       `json:"host_id" validate:"required"`
	Name                string       `json:"name" validate:"required"`
	ImageID             uuid.UUID    `json:"image_id" validate:"required"`
	ModelID             string       `json:"model_id" validate:"required"`
	Life                int64        `json:"life"`
	Resource            *Resource    `json:"resource" validate:"required"`
	InstallCodingAgents bool         `json:"install_coding_agents,omitempty"`
	RepoReq             *TaskRepoReq `json:"repo,omitempty"`
	GitIdentityID       uuid.UUID    `json:"git_identity_id"`
	Now                 time.Time    `json:"-"`
	UsePublicHost       bool         `json:"-"`
}

// UpdateVMReq 更新虚拟机请求
type UpdateVMReq struct {
	ID       string    `json:"id" validate:"required"`
	HostID   string    `json:"host_id" validate:"required"`
	Life     int64     `json:"life" validate:"min=3600"`
	UID      uuid.UUID `json:"-"`
	UserName string    `json:"-"`
}

// UpdateHostReq 更新宿主机请求
type UpdateHostReq struct {
	ID        string `param:"id" validate:"required" json:"-" swaggerignore:"true"`
	IsDefault bool   `json:"is_default,omitempty"`
	Remark    string `json:"remark,omitempty"`
	Weight    *int   `json:"weight,omitempty" validate:"omitempty,min=1"`
}

// ApplyPortReq 申请端口请求
type ApplyPortReq struct {
	ID        string   `json:"id" param:"id" validate:"required" swaggerignore:"true"`
	HostID    string   `json:"host_id" param:"host_id" validate:"required" swaggerignore:"true"`
	Port      uint16   `json:"port" validate:"required,min=1,max=65535"`
	WhiteList []string `json:"white_list" validate:"required,dive,ip"`
	ForwardID string   `json:"forward_id" validate:"omitempty"`
}

// RecyclePortReq 回收端口请求
type RecyclePortReq struct {
	ID        string `json:"id" param:"id" validate:"required" swaggerignore:"true"`
	HostID    string `json:"host_id" param:"host_id" validate:"required" swaggerignore:"true"`
	ForwardID string `json:"forward_id" validate:"required"`
}

// VMPort 虚拟机端口
type VMPort struct {
	ForwardID    *string           `json:"forward_id,omitempty"`
	Port         uint16            `json:"port"`
	PreviewURL   *string           `json:"preview_url,omitempty"`
	Status       consts.PortStatus `json:"status,omitempty"`
	WhiteList    []string          `json:"white_list,omitempty"`
	ErrorMessage string            `json:"error_message,omitempty"`
	Success      *bool             `json:"success,omitempty"`
}

// FireExpiredVMItem 触发过期 VM 结果
type FireExpiredVMItem struct {
	ID      string `json:"id"`
	Message string `json:"message"`
}
