package model

import (
	"encoding/json"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type Kind string

const (
	KindText  Kind = "text"
	KindImage Kind = "image"

	ImageQuality1K = "1K"
	ImageQuality2K = "2K"
	ImageQuality4K = "4K"
)

type Provider string

const (
	ProviderPassthrough     Provider = "passthrough"
	ProviderOpenAIImages    Provider = "openai_images"
	ProviderOpenAIResponses Provider = "openai_responses_image"
	ProviderVolcengine      Provider = "volcengine"
	ProviderXAI             Provider = "xai"
)

type Protocol string

const (
	ProtocolOpenAIChat      Protocol = "openai_chat_completions"
	ProtocolOpenAIResponses Protocol = "openai_responses"
	ProtocolAnthropic       Protocol = "anthropic"
	ProtocolImage           Protocol = "image_generation"
)

type AdvancedConfig struct {
	ContextWindowTokens int64 `json:"context_window_tokens"`
	MaxOutputTokens     int64 `json:"max_output_tokens"`
	SupportsVision      bool  `json:"supports_vision"`
}

type ImageConfig struct {
	Qualities          []string `json:"qualities"`
	AspectRatios       []string `json:"aspect_ratios"`
	DefaultQuality     string   `json:"default_quality"`
	DefaultAspectRatio string   `json:"default_aspect_ratio"`
}

type ImageCapabilities struct {
	Operations          []string            `json:"operations"`
	AllowedAspectRatios map[string][]string `json:"allowed_aspect_ratios,omitempty"`
	MaxImages           uint32              `json:"max_images"`
	MaxReferenceImages  int                 `json:"max_reference_images"`
	SupportsReference   bool                `json:"supports_reference_image"`
	SupportsMask        bool                `json:"supports_mask"`
	Qualities           []string            `json:"-"`
	AspectRatios        []string            `json:"-"`
}

type AgentImageConfig struct {
	ImageConfig
	ImageCapabilities
}

type ImageMultiplier struct {
	Name       string `json:"name"`
	Multiplier string `json:"multiplier"`
}

type ImagePricing struct {
	BaseCreditsPerImage string            `json:"base_credits_per_image"`
	QualityMultipliers  []ImageMultiplier `json:"quality_multipliers,omitempty"`
}

type Authorization struct {
	AllUsers bool     `json:"all_users"`
	UserIDs  []string `json:"user_ids"`
	GroupIDs []string `json:"group_ids"`
}

type Model struct {
	Creator          *Subject          `json:"-"`
	SharedUsers      []Subject         `json:"-"`
	ID               string            `json:"id"`
	OwnershipType    string            `json:"ownership_type"`
	OwnerUserID      string            `json:"-"`
	User             resource.User     `json:"user"`
	ModelID          string            `json:"model_id"`
	DisplayName      string            `json:"display_name"`
	Protocol         Protocol          `json:"protocol"`
	Kind             Kind              `json:"kind"`
	Provider         Provider          `json:"provider"`
	ProviderOptions  json.RawMessage   `json:"-"`
	ImageConfig      *ImageConfig      `json:"image_config,omitempty"`
	ImagePricing     *ImagePricing     `json:"image_pricing,omitempty"`
	BaseURL          string            `json:"base_url"`
	APIKey           string            `json:"-"`
	GrantorUserID    string            `json:"-"`
	APIKeyConfigured bool              `json:"api_key_configured"`
	AdvancedConfig   AdvancedConfig    `json:"advanced_config"`
	CreditMultiplier float64           `json:"credit_multiplier"`
	Authorization    Authorization     `json:"authorization"`
	Tags             []resource.Object `json:"tags"`
	TagIDs           []string          `json:"-"`
	Enabled          bool              `json:"enabled"`
	CreatedAt        time.Time         `json:"created_at"`
	UpdatedAt        time.Time         `json:"updated_at"`
}

type AgentModel struct {
	OwnershipType       string            `json:"ownership_type"`
	User                resource.User     `json:"user"`
	Creator             *Subject          `json:"creator,omitempty"`
	SharedUsers         *[]Subject        `json:"shared_users,omitempty"`
	ID                  string            `json:"id"`
	Model               string            `json:"model"`
	DisplayName         string            `json:"display_name"`
	Protocol            Protocol          `json:"protocol"`
	Kind                Kind              `json:"kind"`
	ImageConfig         *AgentImageConfig `json:"image_config,omitempty"`
	ImagePricing        *ImagePricing     `json:"image_pricing,omitempty"`
	ContextWindowTokens int64             `json:"context_window_tokens"`
	MaxOutputTokens     int64             `json:"max_output_tokens"`
	SupportsVision      bool              `json:"supports_vision"`
	CreditMultiplier    float64           `json:"credit_multiplier"`
	Tags                []resource.Object `json:"tags"`
	UpdatedAt           time.Time         `json:"-"`
}

type Target struct {
	ID              string
	UserID          string
	OwnershipType   string
	UpstreamModelID string
	Protocol        Protocol
	Kind            Kind
	Provider        Provider
	ProviderOptions json.RawMessage
	BaseURL         string
	APIKey          string
}

type Subject struct {
	ID       string  `json:"id"`
	ParentID *string `json:"parent_id,omitempty"`
	Name     string  `json:"name"`
	Email    string  `json:"email,omitempty"`
	GroupID  string  `json:"group_id,omitempty"`
}

type Subjects struct {
	Groups []Subject `json:"groups"`
	Users  []Subject `json:"users"`
}

type SaveInput struct {
	ModelID          string          `json:"model_id"`
	DisplayName      string          `json:"display_name"`
	Protocol         Protocol        `json:"protocol"`
	Kind             Kind            `json:"kind,omitempty"`
	Provider         Provider        `json:"provider,omitempty"`
	ProviderOptions  json.RawMessage `json:"provider_options,omitempty"`
	ImageConfig      *ImageConfig    `json:"image_config,omitempty"`
	ImagePricing     *ImagePricing   `json:"image_pricing,omitempty"`
	BaseURL          string          `json:"base_url"`
	APIKey           string          `json:"api_key"`
	AdvancedConfig   AdvancedConfig  `json:"advanced_config"`
	CreditMultiplier float64         `json:"credit_multiplier"`
	Authorization    Authorization   `json:"authorization"`
	TagIDs           []string        `json:"tag_ids,omitempty"`
}

// 用户不能设置积分倍率或通过模型编辑修改分享范围。
type UserInput struct {
	ModelID        string         `json:"model_id"`
	DisplayName    string         `json:"display_name"`
	Protocol       Protocol       `json:"protocol"`
	Kind           Kind           `json:"kind,omitempty"`
	Provider       Provider       `json:"provider,omitempty"`
	ImageConfig    *ImageConfig   `json:"image_config,omitempty"`
	BaseURL        string         `json:"base_url"`
	APIKey         string         `json:"api_key"`
	AdvancedConfig AdvancedConfig `json:"advanced_config"`
	TagIDs         []string       `json:"tag_ids,omitempty"`
}
