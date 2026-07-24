package domain

import (
	"encoding/json"

	"github.com/google/uuid"
)

const (
	EndpointStatusActive  = "active"
	EndpointStatusRevoked = "revoked"
)

type EndpointProfile struct {
	DeviceName    string `json:"device_name" example:"办公电脑"`
	Platform      string `json:"platform" enums:"macos,windows,linux,ios,android" example:"macos"`
	OSVersion     string `json:"os_version" example:"15.5"`
	Arch          string `json:"arch" example:"arm64"`
	ClientVersion string `json:"client_version" example:"1.0.0"`
}

type EndpointView struct {
	// MachineID 是客户端首次安装生成的 UUIDv4，仅用于同一用户内稳定寻址。
	MachineID uuid.UUID `json:"machine_id" format:"uuid" example:"550e8400-e29b-41d4-a716-446655440000"`
	// DeviceName 是客户端上报的系统设备名。
	DeviceName string `json:"device_name" example:"MacBook Pro"`
	// Alias 是用户设置的端点别名，未设置时为空。
	Alias *string `json:"alias" example:"办公电脑"`
	// DisplayName 是端点展示名，优先使用 alias，否则使用 device_name。
	DisplayName string `json:"display_name" example:"办公电脑"`
	// Platform 是客户端操作系统平台。
	Platform string `json:"platform" enums:"macos,windows,linux,ios,android" example:"macos"`
	// OSVersion 是客户端上报的操作系统版本。
	OSVersion string `json:"os_version" example:"15.5"`
	// Arch 是客户端上报的处理器架构。
	Arch string `json:"arch" example:"arm64"`
	// ClientVersion 是 MonkeyCode 客户端版本。
	ClientVersion string `json:"client_version" example:"1.0.0"`
	// ProtocolVersion 是端点最近一次连接协商成功的桥接协议主版本。
	ProtocolVersion int `json:"protocol_version" example:"1"`
	// Status 是端点管理状态：active 表示可连接，revoked 表示已撤销。
	Status string `json:"status,omitempty" enums:"active,revoked" example:"active"`
	// Online 表示端点当前是否持有有效的在线租约。
	Online bool `json:"online" example:"true"`
	// LastSeenAt 是端点最后在线时间，单位为 Unix 毫秒。
	LastSeenAt *int64 `json:"last_seen_at" example:"1752739200000"`
	// CreatedAt 是端点首次登记时间，单位为 Unix 毫秒。
	CreatedAt *int64 `json:"created_at,omitempty" example:"1752739200000"`
	// UpdatedAt 是端点资料最后更新时间，单位为 Unix 毫秒。
	UpdatedAt *int64 `json:"updated_at,omitempty" example:"1752739200000"`
}

type EndpointHello struct {
	Type             string          `json:"type"`
	ProtocolVersions []int           `json:"protocol_versions"`
	MachineID        uuid.UUID       `json:"machine_id"`
	Profile          EndpointProfile `json:"profile"`
}

type EndpointEnvelope struct {
	Type      string          `json:"type"`
	MessageID uuid.UUID       `json:"message_id"`
	Target    uuid.UUID       `json:"target"`
	Method    string          `json:"method,omitempty"`
	ReplyTo   *uuid.UUID      `json:"reply_to,omitempty"`
	Payload   json.RawMessage `json:"payload"`
	Source    *uuid.UUID      `json:"source,omitempty"`
	RoutedAt  *int64          `json:"routed_at,omitempty"`
}

type EndpointPathReq struct {
	MachineID uuid.UUID `param:"machine_id" validate:"required"`
}

type UpdateEndpointReq struct {
	// Alias 是新的端点别名；null、空字符串或仅含空白字符时清除别名，最长 128 个 Unicode 字符。
	Alias *string `json:"alias" example:"办公电脑"`
}

type EndpointStatusResp struct {
	// MachineID 是本次操作对应的端点机器标识。
	MachineID uuid.UUID `json:"machine_id" format:"uuid" example:"550e8400-e29b-41d4-a716-446655440000"`
	// Status 是操作完成后的端点管理状态。
	Status string `json:"status" enums:"active,revoked" example:"active"`
}
