package consts

const (
	PUBLIC_HOST_ID = "public_host"
)

type VirtualmachineTTLKind string

const (
	CountDown VirtualmachineTTLKind = "countdown"
	Forever   VirtualmachineTTLKind = "forever"
)

type VMRecycleMethod string

const (
	VMRecycleMethodIdle         VMRecycleMethod = "idle"          // 空闲超时回收
	VMRecycleMethodTaskStop     VMRecycleMethod = "task_stop"     // 停止任务回收
	VMRecycleMethodTaskDelete   VMRecycleMethod = "task_delete"   // 删除任务回收
	VMRecycleMethodExpired      VMRecycleMethod = "expired"       // 虚拟机到期回收
	VMRecycleMethodManualDelete VMRecycleMethod = "manual_delete" // 用户手动删除
	VMRecycleMethodForce        VMRecycleMethod = "force"         // 强制回收
	VMRecycleMethodLifecycle    VMRecycleMethod = "lifecycle"     // 生命周期状态回收
)

type HostStatus string

const (
	HostStatusOnline  HostStatus = "online"
	HostStatusOffline HostStatus = "offline"
)

// ProxyProtocol represents the protocol used for proxy connections.
type ProxyProtocol string

const (
	ProxyProtocolHTTP   ProxyProtocol = "http"
	ProxyProtocolHTTPS  ProxyProtocol = "https"
	ProxyProtocolSOCKS5 ProxyProtocol = "socks5"
)

// TerminalMode 终端模式
type TerminalMode string

const (
	TerminalModeReadOnly  TerminalMode = "read_only"
	TerminalModeReadWrite TerminalMode = "read_write"
)

// TerminalType 终端类型
type TerminalType string

const (
	TerminalTypeReadOnly    TerminalType = "terminal_readonly"
	TerminalTypeInteractive TerminalType = "terminal_interactive"
)

type VM_PORT_PROTOCOL string

const (
	VM_PORT_PROTOCOL_HTTP  VM_PORT_PROTOCOL = "http"
	VM_PORT_PROTOCOL_HTTPS VM_PORT_PROTOCOL = "https"
)

type PortStatus string

const (
	PortStatusReversed  PortStatus = "reserved"
	PortStatusConnected PortStatus = "connected"
)
