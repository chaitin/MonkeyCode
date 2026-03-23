package consts

const (
	PUBLIC_HOST_ID = "public_host"
)

type VirtualmachineTTLKind string

const (
	CountDown VirtualmachineTTLKind = "countdown"
	Forever   VirtualmachineTTLKind = "forever"
)

type HostStatus string

const (
	HostStatusOnline  HostStatus = "online"
	HostStatusOffline HostStatus = "offline"
)

// ProxyProtocol represents the protocol used for proxy connections.
type ProxyProtocol string

const (
	ProxyProtocolHTTP    ProxyProtocol = "http"
	ProxyProtocolHTTPS   ProxyProtocol = "https"
	ProxyProtocolSOCKS5  ProxyProtocol = "socks5"
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
