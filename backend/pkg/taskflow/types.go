// Package taskflow 提供 taskflow 服务的客户端实现
package taskflow

import "github.com/google/uuid"

// ==================== 通用响应 ====================

// Resp 通用 API 响应包装
type Resp[T any] struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    T      `json:"data,omitempty"`
}

// ==================== Host 类型 ====================

// Host 宿主机信息
type Host struct {
	ID         string `json:"id"`
	UserID     string `json:"user_id"`
	Hostname   string `json:"hostname"`
	Arch       string `json:"arch"`
	OS         string `json:"os"`
	Name       string `json:"name"`
	Cores      int32  `json:"cores"`
	Memory     uint64 `json:"memory"`
	Disk       uint64 `json:"disk"`
	PublicIP   string `json:"public_ip"`
	InternalIP string `json:"internal_ip"`
	TTL        TTL    `json:"ttl"`
	CreatedAt  int64  `json:"created_at"`
	Version    string `json:"version"`
}

// IsOnlineReq 在线状态查询请求
type IsOnlineReq[T any] struct {
	IDs []T `json:"ids"`
}

// IsOnlineResp 在线状态查询响应
type IsOnlineResp struct {
	OnlineMap map[string]bool `json:"online_map"`
}

// ==================== VirtualMachine 类型 ====================

// VirtualMachineStatus 虚拟机状态
type VirtualMachineStatus string

const (
	VirtualMachineStatusUnknown VirtualMachineStatus = "unknown"
	VirtualMachineStatusPending VirtualMachineStatus = "pending"
	VirtualMachineStatusOnline  VirtualMachineStatus = "online"
	VirtualMachineStatusOffline VirtualMachineStatus = "offline"
)

// TTLKind TTL 类型
type TTLKind uint8

const (
	TTLForever   TTLKind = iota + 1 // 永不过期
	TTLCountDown                    // 计时器过期
)

// TTL 生命周期
type TTL struct {
	Kind    TTLKind `json:"kind"`
	Seconds int64   `json:"seconds"`
}

// VirtualMachine 虚拟机信息
type VirtualMachine struct {
	ID            string               `json:"id"`
	EnvironmentID string               `json:"environment_id"`
	HostID        string               `json:"host_id"`
	Hostname      string               `json:"hostname"`
	Arch          string               `json:"arch"`
	OS            string               `json:"os"`
	Name          string               `json:"name"`
	Repository    string               `json:"repository"`
	Status        VirtualMachineStatus `json:"status"`
	StatusMessage string               `json:"status_message"`
	Cores         int32                `json:"cores"`
	Memory        uint64               `json:"memory"`
	Disk          uint64               `json:"disk"`
	TTL           TTL                  `json:"ttl"`
	ExternalIP    string               `json:"external_ip"`
	CreatedAt     int64                `json:"created_at"`
	Version       string               `json:"version"`
}

// ConditionStatus 条件状态
type ConditionStatus int32

const (
	ConditionStatusUnknown    ConditionStatus = 0
	ConditionStatusInProgress ConditionStatus = 1
	ConditionStatusTrue       ConditionStatus = 2
	ConditionStatusFalse      ConditionStatus = 3
)

// Condition 细粒度状态条件
type Condition struct {
	Type               string          `json:"type,omitempty"`
	Status             ConditionStatus `json:"status,omitempty"`
	Reason             string          `json:"reason,omitempty"`
	Message            string          `json:"message,omitempty"`
	LastTransitionTime int64           `json:"last_transition_time,omitempty"`
	Progress           *int32          `json:"progress,omitempty"`
}

// VirtualMachineCondition 虚拟机条件集合
type VirtualMachineCondition struct {
	EnvID      string       `json:"env_id"`
	Conditions []*Condition `json:"conditions,omitempty"`
}

// ==================== 创建/删除 VM 请求 ====================

// CreateVirtualMachineReq 创建虚拟机请求
type CreateVirtualMachineReq struct {
	UserID              string         `json:"user_id" validate:"required"`
	HostID              string         `json:"host_id" validate:"required"`
	HostName            string         `json:"hostname"`
	Git                 Git            `json:"git"`
	ZipUrl              string         `json:"zip_url"`
	ImageURL            string         `json:"image_url"`
	ProxyURL            string         `json:"proxy_url"`
	TTL                 TTL            `json:"ttl" validate:"required"`
	TaskID              uuid.UUID      `json:"task_id"`
	LLM                 LLMProviderReq `json:"llm"`
	Cores               string         `json:"cores"`
	Memory              uint64         `json:"memory"`
	InstallCodingAgents bool           `json:"install_coding_agents"`
}

// Git 仓库信息
type Git struct {
	URL      string `json:"url"`
	Token    string `json:"token"`
	ProxyURL string `json:"proxy_url"`
	Branch   string `json:"branch,omitempty"`
	Username string `json:"username,omitempty"`
	Email    string `json:"email,omitempty"`
}

// LLMProvider 模型提供商
type LLMProvider string

const (
	LlmProviderOpenAI LLMProvider = "openai"
)

// LLMProviderReq 模型提供商配置
type LLMProviderReq struct {
	Provider    LLMProvider `json:"provider"`
	ApiKey      string      `json:"api_key"`
	BaseURL     string      `json:"base_url"`
	Model       string      `json:"model"`
	Temperature *float32    `json:"temperature,omitempty"`
}

// DeleteVirtualMachineReq 删除虚拟机请求
type DeleteVirtualMachineReq struct {
	HostID string `json:"host_id" query:"host_id" validate:"required"`
	UserID string `json:"user_id" query:"user_id" validate:"required"`
	ID     string `json:"id" query:"id" validate:"required"`
}

// ==================== Terminal 类型 ====================

// TerminalMode 终端模式
type TerminalMode uint8

const (
	TerminalModeReadWrite TerminalMode = iota
	TerminalModeReadOnly
)

// TerminalSize 终端尺寸
type TerminalSize struct {
	Col uint32 `json:"col" query:"col"`
	Row uint32 `json:"row" query:"row"`
}

// TerminalReq 终端连接请求
type TerminalReq struct {
	ID         string       `json:"id" query:"id"`
	Mode       TerminalMode `json:"mode" query:"mode"`
	TerminalID string       `json:"terminal_id" query:"terminal_id" validate:"required"`
	Exec       string       `json:"exec" query:"exec"`
	TerminalSize
}

// TerminalData 终端数据
type TerminalData struct {
	Data      []byte        `json:"data,omitempty"`
	Connected bool          `json:"connected"`
	Resize    *TerminalSize `json:"resize,omitempty"`
	Error     *string       `json:"error,omitempty"`
}

// CloseTerminalReq 关闭终端请求
type CloseTerminalReq struct {
	ID         string `json:"id" query:"id"`
	TerminalID string `json:"terminal_id" query:"terminal_id"`
}

// Terminal 终端信息
type Terminal struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	ConnectedCount uint32 `json:"connected_count"`
	CreatedAt      int64  `json:"created_at"`
}

// ==================== PortForward 类型 ====================

// PortForwardInfo 端口转发信息
type PortForwardInfo struct {
	Port         int32    `json:"port"`
	Status       string   `json:"status"`
	Process      string   `json:"process"`
	ForwardID    *string  `json:"forward_id"`
	AccessURL    *string  `json:"access_url"`
	CreatedAt    int64    `json:"created_at"`
	Success      bool     `json:"success"`
	ErrorMessage string   `json:"error_message,omitempty"`
	WhitelistIPs []string `json:"whitelist_ips"`
}

// CreatePortForward 创建端口转发请求
type CreatePortForward struct {
	ID           string   `json:"id" query:"id" validate:"required"`
	UserID       string   `json:"user_id"`
	LocalPort    int32    `json:"local_port"`
	WhitelistIPs []string `json:"whitelist_ips"`
}

// UpdatePortForward 更新端口转发请求
type UpdatePortForward struct {
	ID           string   `json:"id" query:"id" validate:"required"`
	ForwardID    string   `json:"forward_id"`
	WhitelistIPs []string `json:"whitelist_ips"`
}

// ClosePortForward 关闭端口转发请求
type ClosePortForward struct {
	ID        string `json:"id" query:"id" validate:"required"`
	ForwardID string `json:"forward_id"`
}

// ==================== Stats 类型 ====================

// Stats 统计信息
type Stats struct {
	OnlineHostCount        int `json:"online_host_count"`
	OnlineTaskCount        int `json:"online_task_count"`
	OnlineVMCount          int `json:"online_vm_count"`
	OnlineTerminalCount    int `json:"online_terminal_count"`
	UsingTerminalUserCount int `json:"using_terminal_user_count"`
}
