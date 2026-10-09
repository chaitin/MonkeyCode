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
	KindVideo Kind = "video"

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
	ProviderMiniMax         Provider = "minimax"
)

type Protocol string

const (
	ProtocolOpenAIChat      Protocol = "openai_chat_completions"
	ProtocolOpenAIResponses Protocol = "openai_responses"
	ProtocolAnthropic       Protocol = "anthropic"
	ProtocolImage           Protocol = "image_generation"
	ProtocolVideo           Protocol = "video_generation"
)

type AdvancedConfig struct {
	ContextWindowTokens int64 `json:"context_window_tokens"`
	MaxOutputTokens     int64 `json:"max_output_tokens"`
	SupportsVision      bool  `json:"supports_vision"`
	SupportsReasoning   bool  `json:"supports_reasoning"`
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

type VideoMode string

const (
	VideoTextToVideo           VideoMode = "text_to_video"
	VideoImageToVideo          VideoMode = "image_to_video"
	VideoLastFrameToVideo      VideoMode = "last_frame_to_video"
	VideoFirstLastToVideo      VideoMode = "first_last_to_video"
	VideoReferenceImageToVideo VideoMode = "reference_image_to_video"
)

type VideoParamSpec struct {
	Name    string            `json:"name"`
	Type    string            `json:"type"`
	Choices []json.RawMessage `json:"choices,omitempty"`
	Min     *int64            `json:"min,omitempty"`
	Max     *int64            `json:"max,omitempty"`
	Step    *int64            `json:"step,omitempty"`
}

type VideoCondition struct {
	Modes       []VideoMode                `json:"modes,omitempty"`
	ParamEquals map[string]json.RawMessage `json:"param_equals,omitempty"`
}

type VideoParamRule struct {
	When    VideoCondition    `json:"when"`
	Name    string            `json:"name"`
	Choices []json.RawMessage `json:"choices,omitempty"`
	Min     *int64            `json:"min,omitempty"`
	Max     *int64            `json:"max,omitempty"`
	Step    *int64            `json:"step,omitempty"`
}

type VideoReferenceSpec struct {
	Role           string   `json:"role"`
	MediaType      string   `json:"media_type"`
	MaxCount       uint32   `json:"max_count"`
	MIME           []string `json:"mime"`
	MaxBytes       uint64   `json:"max_bytes"`
	MinWidth       uint32   `json:"min_width,omitempty"`
	MaxWidth       uint32   `json:"max_width,omitempty"`
	MinHeight      uint32   `json:"min_height,omitempty"`
	MaxHeight      uint32   `json:"max_height,omitempty"`
	MinAspectRatio string   `json:"min_aspect_ratio,omitempty"`
	MaxAspectRatio string   `json:"max_aspect_ratio,omitempty"`
}

type VideoModeReferences struct {
	Mode          VideoMode `json:"mode"`
	RequiredRoles []string  `json:"required_roles"`
	OptionalRoles []string  `json:"optional_roles"`
}

type VideoParamLimit struct {
	Choices []json.RawMessage `json:"choices,omitempty"`
	Min     *int64            `json:"min,omitempty"`
	Max     *int64            `json:"max,omitempty"`
	Step    *int64            `json:"step,omitempty"`
}

type VideoConfig struct {
	Modes    []VideoMode                              `json:"modes"`
	Limits   map[VideoMode]map[string]VideoParamLimit `json:"limits,omitempty"`
	Defaults map[VideoMode]map[string]json.RawMessage `json:"defaults"`
}

type VideoCapabilities struct {
	Modes               []VideoMode           `json:"modes"`
	Params              []VideoParamSpec      `json:"params"`
	ParamRules          []VideoParamRule      `json:"param_rules,omitempty"`
	References          []VideoReferenceSpec  `json:"references"`
	ReferenceModes      []VideoModeReferences `json:"reference_modes"`
	PromptMaxCharacters uint32                `json:"prompt_max_characters"`
	PromptRequiredWhen  []VideoCondition      `json:"prompt_required_when,omitempty"`
}

type AgentVideoConfig struct {
	VideoConfig
	Params              []VideoParamSpec      `json:"params"`
	ParamRules          []VideoParamRule      `json:"param_rules,omitempty"`
	References          []VideoReferenceSpec  `json:"references"`
	ReferenceModes      []VideoModeReferences `json:"reference_modes"`
	PromptMaxCharacters uint32                `json:"prompt_max_characters"`
	PromptRequiredWhen  []VideoCondition      `json:"prompt_required_when,omitempty"`
}

type VideoResolutionRate struct {
	Resolution       string `json:"resolution"`
	CreditsPerSecond string `json:"credits_per_second"`
}

type VideoPricing struct {
	Rates []VideoResolutionRate `json:"rates"`
}

type Authorization struct {
	AllUsers bool     `json:"all_users"`
	UserIDs  []string `json:"user_ids"`
	GroupIDs []string `json:"group_ids"`
}

type Model struct {
	Creator          *Subject           `json:"-"`
	SharedUsers      []Subject          `json:"-"`
	SharedGroups     *[]resource.Object `json:"shared_groups,omitempty"`
	ID               string             `json:"id"`
	OwnershipType    string             `json:"ownership_type"`
	OwnerUserID      string             `json:"-"`
	User             resource.User      `json:"user"`
	ModelID          string             `json:"model_id"`
	DisplayName      string             `json:"display_name"`
	Protocol         Protocol           `json:"protocol"`
	Kind             Kind               `json:"kind"`
	Provider         Provider           `json:"provider"`
	ProviderOptions  json.RawMessage    `json:"-"`
	ImageConfig      *ImageConfig       `json:"image_config,omitempty"`
	ImagePricing     *ImagePricing      `json:"image_pricing,omitempty"`
	VideoConfig      *VideoConfig       `json:"video_config,omitempty"`
	VideoPricing     *VideoPricing      `json:"video_pricing,omitempty"`
	BaseURL          string             `json:"base_url"`
	APIKey           string             `json:"-"`
	GrantorUserID    string             `json:"-"`
	APIKeyConfigured bool               `json:"api_key_configured"`
	AdvancedConfig   AdvancedConfig     `json:"advanced_config"`
	CreditMultiplier float64            `json:"credit_multiplier"`
	Authorization    Authorization      `json:"authorization"`
	Tags             []resource.Object  `json:"tags"`
	TagIDs           []string           `json:"-"`
	Enabled          bool               `json:"enabled"`
	CreatedAt        time.Time          `json:"created_at"`
	UpdatedAt        time.Time          `json:"updated_at"`
}

type AgentModel struct {
	OwnershipType       string             `json:"ownership_type"`
	User                resource.User      `json:"user"`
	Creator             *Subject           `json:"creator,omitempty"`
	SharedUsers         *[]Subject         `json:"shared_users,omitempty"`
	SharedGroups        *[]resource.Object `json:"shared_groups,omitempty"`
	ID                  string             `json:"id"`
	Model               string             `json:"model"`
	DisplayName         string             `json:"display_name"`
	Protocol            Protocol           `json:"protocol"`
	Kind                Kind               `json:"kind"`
	ImageConfig         *AgentImageConfig  `json:"image_config,omitempty"`
	ImagePricing        *ImagePricing      `json:"image_pricing,omitempty"`
	VideoConfig         *AgentVideoConfig  `json:"video_config,omitempty"`
	VideoPricing        *VideoPricing      `json:"video_pricing,omitempty"`
	ContextWindowTokens int64              `json:"context_window_tokens"`
	MaxOutputTokens     int64              `json:"max_output_tokens"`
	SupportsVision      bool               `json:"supports_vision"`
	SupportsReasoning   bool               `json:"supports_reasoning"`
	CreditMultiplier    float64            `json:"credit_multiplier"`
	Tags                []resource.Object  `json:"tags"`
	UpdatedAt           time.Time          `json:"-"`
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
	VideoConfig      *VideoConfig    `json:"video_config,omitempty"`
	VideoPricing     *VideoPricing   `json:"video_pricing,omitempty"`
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
	VideoConfig    *VideoConfig   `json:"video_config,omitempty"`
	BaseURL        string         `json:"base_url"`
	APIKey         string         `json:"api_key"`
	AdvancedConfig AdvancedConfig `json:"advanced_config"`
	TagIDs         []string       `json:"tag_ids,omitempty"`
}
