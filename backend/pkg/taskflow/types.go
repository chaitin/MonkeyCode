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
	VirtualMachineStatusUnknown    VirtualMachineStatus = "unknown"
	VirtualMachineStatusPending    VirtualMachineStatus = "pending"
	VirtualMachineStatusOnline     VirtualMachineStatus = "online"
	VirtualMachineStatusOffline    VirtualMachineStatus = "offline"
	VirtualMachineStatusHibernated VirtualMachineStatus = "hibernated"
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
	TaskID              uuid.UUID      `json:"task_id"`
	LLM                 LLMProviderReq `json:"llm"`
	Cores               string         `json:"cores"`
	Memory              uint64         `json:"memory"`
	InstallCodingAgents bool           `json:"install_coding_agents"`
	Envs                []string       `json:"envs,omitempty"`
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

// ==================== Internal Callback 类型（taskflow → 本服务回调） ====================

// TokenKind token 类型
type TokenKind string

const (
	OrchestratorToken TokenKind = "orshcestrator"
	AgentToken        TokenKind = "agent"
)

// CheckTokenReq 认证请求
type CheckTokenReq struct {
	Token     string `json:"token" validate:"required"`
	MachineID string `json:"machine_id"`
}

// TokenUser token 中的用户信息
type TokenUser struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	AvatarURL string     `json:"avatar_url"`
	Email     string     `json:"email"`
	Team      *TokenTeam `json:"team"`
}

// TokenTeam token 中的团队信息
type TokenTeam struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Token 认证结果
type Token struct {
	Kind        TokenKind  `json:"kind"`
	User        *TokenUser `json:"user"`
	ParentToken string     `json:"parent_token"`
	Token       string     `json:"token"`
	TaskID      uuid.UUID  `json:"task_id"`
	SessionID   string     `json:"session_id"`
	RemoteIP    string     `json:"remote_ip"`
	Version     string     `json:"version"`
}

// ListLLMReq 列出 LLM 请求
type ListLLMReq struct {
	VmID   string `json:"vm_id" validate:"required"`
	HostID string `json:"host_id" validate:"required"`
}

// LLMInfo LLM 信息
type LLMInfo struct {
	ApiKey      string   `json:"api_key"`
	BaseURL     string   `json:"base_url"`
	Model       string   `json:"model"`
	Temperature *float32 `json:"temperature,omitempty"`
}

// GetCodingConfigReq 获取编码配置请求
type GetCodingConfigReq struct {
	VmID string `json:"vm_id"`
}

// CodingConfig 编码配置
type CodingConfig struct{}

// GitCredentialRequest git 凭证请求
type GitCredentialRequest struct {
	TaskID   string `json:"task_id"`  // 任务 id
	VMID     string `json:"vm_id"`    // 虚拟机 id
	Protocol string `json:"protocol"` // git 协议 (e.g., "https")
	Host     string `json:"host"`     // git server host (e.g., "gitlab.example.com")
	Path     string `json:"path"`     // 仓库路径 (e.g., "owner/repo.git")
}

// GitCredentialResponse git 凭证响应
type GitCredentialResponse struct {
	Username *string `json:"username,omitempty"`
	Password *string `json:"password,omitempty"`
	Error    *string `json:"error,omitempty"`
}

// ==================== Task Stream 类型 ====================

// TaskChunk Loki 日志中的任务数据块
type TaskChunk struct {
	Data      []byte `json:"data,omitempty"`
	Event     string `json:"event"`
	Kind      string `json:"kind"`
	Timestamp int64  `json:"timestamp,omitempty"`
}

// AskUserQuestionResponse 用户回答 AI 提问的响应
type AskUserQuestionResponse struct {
	TaskId      string `json:"task_id,omitempty"`
	RequestId   string `json:"request_id,omitempty"`
	AnswersJson string `json:"answers_json,omitempty"`
	Cancelled   bool   `json:"cancelled,omitempty"`
}

// ApplyWebClientIPReq 同步 Web 客户端 IP 请求
type ApplyWebClientIPReq struct {
	ClientIP string `json:"client_ip"`
}

// GetTaskStreamIPsReq 获取任务 WebSocket 连接 IP 请求
type GetTaskStreamIPsReq struct {
	TaskID string `json:"task_id"`
}

// GetTaskStreamIPsResp 获取任务 WebSocket 连接 IP 响应
type GetTaskStreamIPsResp struct {
	IPs []string `json:"ips"`
}

// ==================== Repo 操作类型 ====================

// RepoFileChangesReq 文件变动列表请求
type RepoFileChangesReq struct {
	TaskId    string `json:"task_id,omitempty"`
	RequestId string `json:"request_id"`
}

// RepoFileChanges 文件变动列表响应
type RepoFileChanges struct {
	TaskId     string                `json:"task_id,omitempty"`
	RequestId  string                `json:"request_id,omitempty"`
	Changes    []*RepoFileChangeInfo `json:"changes,omitempty"`
	Branch     *string               `json:"branch,omitempty"`
	CommitHash *string               `json:"commit_hash,omitempty"`
	Success    bool                  `json:"success"`
	Error      *string               `json:"error,omitempty"`
}

// RepoFileChangeInfo 单个文件变动信息
type RepoFileChangeInfo struct {
	Path      string  `json:"path,omitempty"`
	Status    string  `json:"status,omitempty"`
	Additions *int32  `json:"additions,omitempty"`
	Deletions *int32  `json:"deletions,omitempty"`
	OldPath   *string `json:"old_path,omitempty"`
}

// RepoListFilesReq 列出文件请求
type RepoListFilesReq struct {
	TaskId        string  `json:"task_id,omitempty"`
	RequestId     string  `json:"request_id"`
	Path          string  `json:"path"`
	GlobPattern   *string `json:"glob_pattern"`
	IncludeHidden bool    `json:"include_hidden"`
}

// RepoListFiles 列出文件响应
type RepoListFiles struct {
	TaskId    string          `json:"task_id,omitempty"`
	RequestId string          `json:"request_id"`
	Path      string          `json:"path,omitempty"`
	Files     []*RepoFileInfo `json:"files,omitempty"`
	Success   bool            `json:"success,omitempty"`
	Error     *string         `json:"error,omitempty"`
}

// RepoEntryMode 文件条目类型
type RepoEntryMode int32

const (
	RepoEntryModeUnspecified RepoEntryMode = 0
	RepoEntryModeFile        RepoEntryMode = 1
	RepoEntryModeExecutable  RepoEntryMode = 2
	RepoEntryModeSymlink     RepoEntryMode = 3
	RepoEntryModeTree        RepoEntryMode = 4
	RepoEntryModeSubmodule   RepoEntryMode = 5
)

// RepoFileInfo 文件信息
type RepoFileInfo struct {
	Name          string        `json:"name,omitempty"`
	Path          string        `json:"path,omitempty"`
	EntryMode     RepoEntryMode `json:"entry_mode,omitempty"`
	Size          int64         `json:"size,omitempty"`
	ModifiedAt    int64         `json:"modified_at,omitempty"`
	Mode          *uint32       `json:"mode,omitempty"`
	SymlinkTarget *string       `json:"symlink_target,omitempty"`
}

// RepoReadFileReq 读取文件请求
type RepoReadFileReq struct {
	TaskId    string `json:"task_id,omitempty"`
	RequestId string `json:"request_id"`
	Path      string `json:"path"`
	Offset    *int64 `json:"offset"`
	Length    *int64 `json:"length"`
}

// RepoReadFile 读取文件响应
type RepoReadFile struct {
	TaskId      string  `json:"task_id,omitempty"`
	RequestId   string  `json:"request_id"`
	Path        string  `json:"path,omitempty"`
	Content     []byte  `json:"content,omitempty"`
	TotalSize   int64   `json:"total_size,omitempty"`
	Offset      int64   `json:"offset,omitempty"`
	Length      int64   `json:"length,omitempty"`
	IsTruncated bool    `json:"is_truncated,omitempty"`
	Success     bool    `json:"success"`
	Error       *string `json:"error,omitempty"`
}

// RepoFileDiffReq 文件 diff 请求
type RepoFileDiffReq struct {
	TaskId       string `json:"task_id,omitempty"`
	RequestId    string `json:"request_id"`
	Path         string `json:"path"`
	Unified      *bool  `json:"unified"`
	ContextLines *int32 `json:"context_lines"`
}

// RepoFileDiff 文件 diff 响应
type RepoFileDiff struct {
	TaskId    string  `json:"task_id,omitempty"`
	RequestId string  `json:"request_id"`
	Path      string  `json:"path,omitempty"`
	Diff      string  `json:"diff,omitempty"`
	Success   bool    `json:"success"`
	Error     *string `json:"error,omitempty"`
}

// RestartTaskReq 重启任务请求
type RestartTaskReq struct {
	ID          uuid.UUID `json:"id"`
	RequestId   string    `json:"request_id,omitempty"`
	LoadSession bool      `json:"load_session"`
}

// RestartTaskResp 重启任务响应
type RestartTaskResp struct {
	ID        uuid.UUID `json:"id"`
	RequestId string    `json:"request_id,omitempty"`
	Success   bool      `json:"success"`
	Message   string    `json:"message"`
	SessionID string    `json:"session_id"`
}

// TaskApproveReq 任务自动批准请求
type TaskApproveReq struct {
	ID          uuid.UUID `json:"id"`
	AutoApprove *bool     `json:"auto_approve,omitempty"`
}

// TaskReq 任务请求（通用）
type TaskReq struct {
	VirtualMachine *VirtualMachine `json:"virtual_machine,omitempty"`
	Task           *Task           `json:"task,omitempty"`
}

// Task 任务信息
type Task struct {
	ID    uuid.UUID `json:"id"`
	Text  string    `json:"text"`
	Image string    `json:"image"`
}

// ==================== CreateTask 类型 ====================

// CodingAgent 编码代理类型
type CodingAgent int

const (
	CodingAgentCodex CodingAgent = iota + 1
	CodingAgentClaude
	CodingAgentMCAIReview
	CodingAgentOpenCode
)

// LLM 模型配置
type LLM struct {
	ApiKey      string   `json:"api_key"`
	BaseURL     string   `json:"base_url"`
	Model       string   `json:"model"`
	ApiType     string   `json:"api_type,omitempty"` // 接口类型 anthropic | openai
	Temperature *float32 `json:"temperature,omitempty"`
}

// ConfigFile 配置文件
type ConfigFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// McpHttpHeader MCP HTTP 头
type McpHttpHeader struct {
	Name  string `json:"name,omitempty"`
	Value string `json:"value,omitempty"`
}

// McpServerConfig MCP 服务器配置
type McpServerConfig struct {
	Type    string            `json:"type,omitempty"`
	Name    string            `json:"name,omitempty"`
	Url     *string           `json:"url,omitempty"`
	Headers []*McpHttpHeader  `json:"headers,omitempty"`
	Command *string           `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}

// CreateTaskReq 创建任务请求
type CreateTaskReq struct {
	ID           uuid.UUID         `json:"id"`
	VMID         string            `json:"vm_id"`
	SystemPrompt string            `json:"system_prompt,omitempty"`
	Text         string            `json:"text,omitempty"`
	LLM          LLM               `json:"llm,omitzero"`
	CodingAgent  CodingAgent       `json:"coding_agent,omitempty"`
	Configs      []ConfigFile      `json:"configs,omitzero"`
	McpConfigs   []McpServerConfig `json:"mcp_configs,omitzero"`
	Env          map[string]string `json:"env,omitempty"`
}

// ==================== VirtualMachine 查询类型 ====================

// VirtualMachineInfoReq 虚拟机信息查询请求
type VirtualMachineInfoReq struct {
	ID     string `json:"id" query:"id"`
	UserID string `json:"user_id" query:"user_id"`
}

// ==================== Report 类型 ====================

// ReportSubscribeReq 报告订阅请求
type ReportSubscribeReq struct {
	ID      string `json:"id" query:"id" validate:"required"`
	History int64  `json:"history" query:"history"`
	FromID  string `json:"from_id" query:"from_id"`
}

// ==================== FileManager 类型 ====================

// FileKind 文件类型
type FileKind string

const (
	FileKindUnknown FileKind = "unknown"
	FileKindFile    FileKind = "file"
	FileKindDir     FileKind = "dir"
	FileKindSymlink FileKind = "symlink"
)

// FileOP 文件操作类型
type FileOP string

const (
	FileOpSave     FileOP = "save"
	FileOpDelete   FileOP = "delete"
	FileOpCopy     FileOP = "copy"
	FileOpMove     FileOP = "move"
	FileOpMkdir    FileOP = "mkdir"
	FileOpList     FileOP = "list"
	FileOpDownload FileOP = "download"
)

// FileReq 文件操作请求
type FileReq struct {
	Operate FileOP `json:"operate" query:"operate"`
	UserID  string `json:"user_id" query:"user_id"`
	ID      string `json:"id" query:"id"`
	Path    string `json:"path,omitempty" query:"path"`
	Source  string `json:"source,omitempty" query:"source"`
	Target  string `json:"target,omitempty" query:"target"`
	Content string `json:"content,omitempty" query:"content"`
}

// File 文件信息
type File struct {
	Name          string   `json:"name"`
	User          string   `json:"user"`
	Size          uint64   `json:"size"`
	Kind          FileKind `json:"kind"`
	SymlinkTarget string   `json:"symlink_target,omitempty"`
	SymlinkKind   FileKind `json:"symlink_kind,omitempty"`
	UnixMode      uint32   `json:"unix_mode"`
	CreatedAt     int64    `json:"created_at"`
	AccessedAt    int64    `json:"accessed_at"`
	UpdatedAt     int64    `json:"updated_at"`
}

type HibernateVirtualMachineReq struct {
	HostID        string `json:"host_id" query:"host_id" validate:"required"` // 宿主机 id
	UserID        string `json:"user_id" query:"user_id" validate:"required"` // 用户id
	ID            string `json:"id" query:"id" validate:"required"`           // 虚拟机 id
	EnvironmentID string `json:"environment_id" query:"environment_id"`       // environment id
}

type ResumeVirtualMachineReq struct {
	HostID        string `json:"host_id" query:"host_id" validate:"required"` // 宿主机 id
	UserID        string `json:"user_id" query:"user_id" validate:"required"` // 用户id
	ID            string `json:"id" query:"id" validate:"required"`           // 虚拟机 id
	EnvironmentID string `json:"environment_id" query:"environment_id"`       // environment id
}
