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
	DeviceName    string `json:"device_name"`
	Platform      string `json:"platform"`
	OSVersion     string `json:"os_version"`
	Arch          string `json:"arch"`
	ClientVersion string `json:"client_version"`
}

type EndpointView struct {
	MachineID       uuid.UUID `json:"machine_id"`
	DeviceName      string    `json:"device_name"`
	Alias           *string   `json:"alias"`
	DisplayName     string    `json:"display_name"`
	Platform        string    `json:"platform"`
	OSVersion       string    `json:"os_version"`
	Arch            string    `json:"arch"`
	ClientVersion   string    `json:"client_version"`
	ProtocolVersion int       `json:"protocol_version"`
	Status          string    `json:"status,omitempty"`
	Online          bool      `json:"online"`
	LastSeenAt      *int64    `json:"last_seen_at"`
	CreatedAt       *int64    `json:"created_at,omitempty"`
	UpdatedAt       *int64    `json:"updated_at,omitempty"`
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
