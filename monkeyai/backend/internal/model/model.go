package model

import (
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type Protocol string

const (
	ProtocolOpenAIChat      Protocol = "openai_chat_completions"
	ProtocolOpenAIResponses Protocol = "openai_responses"
	ProtocolAnthropic       Protocol = "anthropic"
)

type AdvancedConfig struct {
	ContextWindowTokens int64 `json:"context_window_tokens"`
	MaxOutputTokens     int64 `json:"max_output_tokens"`
	SupportsVision      bool  `json:"supports_vision"`
}

type Authorization struct {
	AllUsers bool     `json:"all_users"`
	UserIDs  []string `json:"user_ids"`
	GroupIDs []string `json:"group_ids"`
}

type Model struct {
	Creator          *Subject       `json:"-"`
	SharedUsers      []Subject      `json:"-"`
	ID               string         `json:"id"`
	OwnershipType    string         `json:"ownership_type"`
	OwnerUserID      string         `json:"-"`
	User             resource.User  `json:"user"`
	ModelID          string         `json:"model_id"`
	DisplayName      string         `json:"display_name"`
	Protocol         Protocol       `json:"protocol"`
	BaseURL          string         `json:"base_url"`
	APIKey           string         `json:"-"`
	GrantorUserID    string         `json:"-"`
	APIKeyConfigured bool           `json:"api_key_configured"`
	AdvancedConfig   AdvancedConfig `json:"advanced_config"`
	CreditMultiplier float64        `json:"credit_multiplier"`
	Authorization    Authorization  `json:"authorization"`
	Enabled          bool           `json:"enabled"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
}

type AgentModel struct {
	OwnershipType       string        `json:"ownership_type"`
	User                resource.User `json:"user"`
	Creator             *Subject      `json:"creator,omitempty"`
	SharedUsers         *[]Subject    `json:"shared_users,omitempty"`
	ID                  string        `json:"id"`
	Model               string        `json:"model"`
	DisplayName         string        `json:"display_name"`
	Protocol            Protocol      `json:"protocol"`
	ContextWindowTokens int64         `json:"context_window_tokens"`
	MaxOutputTokens     int64         `json:"max_output_tokens"`
	SupportsVision      bool          `json:"supports_vision"`
	CreditMultiplier    float64       `json:"credit_multiplier"`
	UpdatedAt           time.Time     `json:"-"`
}

type Target struct {
	ID              string
	UserID          string
	UpstreamModelID string
	Protocol        Protocol
	BaseURL         string
	APIKey          string
}

type Subject struct {
	ID       string  `json:"id"`
	ParentID *string `json:"parent_id,omitempty"`
	Name     string  `json:"name"`
	Email    string  `json:"email,omitempty"`
}

type Subjects struct {
	Groups []Subject `json:"groups"`
	Users  []Subject `json:"users"`
}

type SaveInput struct {
	ModelID          string         `json:"model_id"`
	DisplayName      string         `json:"display_name"`
	Protocol         Protocol       `json:"protocol"`
	BaseURL          string         `json:"base_url"`
	APIKey           string         `json:"api_key"`
	AdvancedConfig   AdvancedConfig `json:"advanced_config"`
	CreditMultiplier float64        `json:"credit_multiplier"`
	Authorization    Authorization  `json:"authorization"`
}

// 用户不能设置积分倍率或通过模型编辑修改分享范围。
type UserInput struct {
	ModelID        string         `json:"model_id"`
	DisplayName    string         `json:"display_name"`
	Protocol       Protocol       `json:"protocol"`
	BaseURL        string         `json:"base_url"`
	APIKey         string         `json:"api_key"`
	AdvancedConfig AdvancedConfig `json:"advanced_config"`
}
