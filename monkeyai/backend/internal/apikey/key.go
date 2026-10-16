package apikey

import "time"

const (
	ScopeModelInvoke = "model:invoke"
	ScopeMCPInvoke   = "mcp:invoke"
)

type Key struct {
	MachineID      *string    `json:"machine_id,omitempty"`
	RuntimeGrantID *string    `json:"runtime_grant_id,omitempty"`
	ID             string     `json:"id"`
	UserID         string     `json:"user_id"`
	UserName       string     `json:"user_name,omitempty"`
	Name           string     `json:"name"`
	Prefix         string     `json:"key_prefix"`
	Scopes         []string   `json:"scopes"`
	ExpiresAt      time.Time  `json:"expires_at"`
	LastUsedAt     *time.Time `json:"last_used_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
}

type CreatedKey struct {
	Key
	APIKey string `json:"api_key"`
}

type CreateInput struct {
	Name          string   `json:"name"`
	Scopes        []string `json:"scopes"`
	ExpiresInDays int      `json:"expires_in_days"`
}
