package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
)

// ModelUsecase 模型配置业务逻辑接口
type ModelUsecase interface {
	List(ctx context.Context, uid uuid.UUID, cursor CursorReq) (*ListModelResp, error)
	Create(ctx context.Context, uid uuid.UUID, req *CreateModelReq) (*Model, error)
	Delete(ctx context.Context, uid uuid.UUID, id uuid.UUID) error
	Update(ctx context.Context, uid, id uuid.UUID, req *UpdateModelReq) error
	Check(ctx context.Context, uid, id uuid.UUID) (*CheckModelResp, error)
	CheckByConfig(ctx context.Context, req *CheckByConfigReq) (*CheckModelResp, error)
	GetProviderModelList(ctx context.Context, req *GetProviderModelListReq) (*GetProviderModelListResp, error)
}

// ModelRepo 模型配置数据仓库接口
type ModelRepo interface {
	Get(ctx context.Context, uid, id uuid.UUID) (*db.Model, error)
	List(ctx context.Context, uid uuid.UUID, cursor CursorReq) ([]*db.Model, *db.Cursor, error)
	Create(ctx context.Context, uid uuid.UUID, req *CreateModelReq) (*db.Model, error)
	Delete(ctx context.Context, uid, id uuid.UUID) error
	Update(ctx context.Context, uid, id uuid.UUID, req *UpdateModelReq) error
	UpdateCheckResult(ctx context.Context, id uuid.UUID, success bool, errMsg string) error
}

// Model 模型配置
type Model struct {
	ID               uuid.UUID            `json:"id"`
	Provider         string               `json:"provider"`
	APIKey           string               `json:"api_key,omitempty"`
	BaseURL          string               `json:"base_url"`
	Model            string               `json:"model"`
	Temperature      float64              `json:"temperature"`
	IsDefault        bool                 `json:"is_default"`
	CreatedAt        int64                `json:"created_at"`
	UpdatedAt        int64                `json:"updated_at"`
	Owner            *Owner               `json:"owner,omitempty"`
	InterfaceType    consts.InterfaceType `json:"interface_type"`
	IsFree           bool                 `json:"is_free"`
	AccessLevel      string               `json:"access_level"` // 访问级别 basic | pro
	LastCheckAt      int64                `json:"last_check_at"`
	LastCheckSuccess bool                 `json:"last_check_success"`
	LastCheckError   string               `json:"last_check_error"`
}

func (m *Model) From(src *db.Model) *Model {
	if src == nil {
		return m
	}

	m.ID = src.ID
	m.Provider = src.Provider
	m.APIKey = src.APIKey
	m.BaseURL = src.BaseURL
	m.Model = src.Model
	m.Temperature = src.Temperature
	m.InterfaceType = consts.InterfaceType(src.InterfaceType)
	m.LastCheckSuccess = src.LastCheckSuccess
	m.LastCheckError = src.LastCheckError
	m.CreatedAt = src.CreatedAt.Unix()
	m.UpdatedAt = src.UpdatedAt.Unix()
	m.LastCheckAt = src.LastCheckAt.Unix()

	if src.Remark == "economy" {
		m.APIKey = ""
		m.BaseURL = ""
	}

	if src.Edges.User == nil {
		return m
	}

	m.Owner = &Owner{
		ID:   src.Edges.User.ID.String(),
		Type: consts.OwnerTypePrivate,
		Name: src.Edges.User.Name,
	}

	if teams := src.Edges.User.Edges.Teams; src.Edges.User.Role == consts.UserRoleEnterprise && len(teams) > 0 {
		team := teams[0]
		m.Owner = &Owner{
			ID:   team.ID.String(),
			Type: consts.OwnerTypeTeam,
			Name: team.Name,
		}
		m.APIKey = ""
		return m
	}
	return m
}

func (m *Model) GetIsDefault(user *db.User) bool {
	if defaultModelID, ok := user.DefaultConfigs[consts.DefaultConfigTypeModel]; ok {
		if defaultModelID.String() == m.ID.String() {
			return true
		}
	}
	return false
}

// ListModelResp 获取用户模型配置列表响应
type ListModelResp struct {
	Models []*Model   `json:"models"`
	Page   *db.Cursor `json:"page"`
}

// CreateModelReq 创建模型配置请求
type CreateModelReq struct {
	Provider      string               `json:"provider" validate:"required"`
	APIKey        string               `json:"api_key" validate:"required"`
	BaseURL       string               `json:"base_url" validate:"required"`
	Model         string               `json:"model" validate:"required"`
	Temperature   float32              `json:"temperature"`
	IsDefault     bool                 `json:"is_default"`
	InterfaceType consts.InterfaceType `json:"interface_type" validate:"required,oneof=openai_chat openai_responses anthropic"`
}

// CreateModelResp 创建模型配置响应
type CreateModelResp struct {
	ID uuid.UUID `json:"id"`
}

// DeleteModelConfigReq 删除模型配置请求
type DeleteModelConfigReq struct {
	ID uuid.UUID `param:"id" validate:"required"`
}

// CheckModelReq 检查模型健康状态请求（通过ID）
type CheckModelReq struct {
	ID uuid.UUID `param:"id" validate:"required"`
}

// CheckByConfigReq 检查模型健康状态请求（通过配置）
type CheckByConfigReq struct {
	Provider      consts.ModelProvider `json:"provider" validate:"required"`
	APIKey        string               `json:"api_key" validate:"required"`
	BaseURL       string               `json:"base_url" validate:"required"`
	Model         string               `json:"model" validate:"required"`
	InterfaceType consts.InterfaceType `json:"interface_type,omitempty" validate:"omitempty,oneof=openai_chat openai_responses anthropic"`
}

// CheckModelResp 检查模型健康状态响应
type CheckModelResp struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// UpdateModelReq 更新模型配置请求
type UpdateModelReq struct {
	ID            uuid.UUID             `param:"id" validate:"required" json:"-" swaggerignore:"true"`
	Provider      *string               `json:"provider,omitempty"`
	APIKey        *string               `json:"api_key,omitempty"`
	BaseURL       *string               `json:"base_url,omitempty"`
	Model         *string               `json:"model,omitempty"`
	Temperature   *float32              `json:"temperature,omitempty"`
	IsDefault     *bool                 `json:"is_default,omitempty"`
	InterfaceType *consts.InterfaceType `json:"interface_type,omitempty" validate:"omitempty,oneof=openai_chat openai_responses anthropic"`
}

type GetProviderModelListReq struct {
	Provider  consts.ModelProvider `json:"provider" query:"provider" validate:"required,oneof=SiliconFlow OpenAI Ollama DeepSeek Moonshot AzureOpenAI BaiZhiCloud Hunyuan BaiLian Volcengine Gemini Other"`
	BaseURL   string               `json:"base_url" query:"base_url" validate:"required"`
	APIKey    string               `json:"api_key" query:"api_key" validate:"required"`
	APIHeader string               `json:"api_header" query:"api_header"`
}

type GetProviderModelListResp struct {
	Models []ProviderModelListItem `json:"models"`
	Error  *OpenAIError            `json:"error,omitempty"`
}

type ProviderModelListItem struct {
	Model string `json:"model"`
}

type OpenAIResp struct {
	Object string        `json:"object"`
	Data   []*OpenAIData `json:"data"`
	Error  *OpenAIError  `json:"error,omitempty"`
}

type OpenAIData struct {
	ID string `json:"id"`
}

type OpenAIError struct {
	Message string `json:"message"`
	Type    string `json:"type"`
}

var ModelProviderBrandModelsList = map[consts.ModelProvider][]ProviderModelListItem{
	consts.ModelProviderOpenAI: {
		{Model: "gpt-4o"},
	},
	consts.ModelProviderDeepSeek: {
		{Model: "deepseek-reasoner"},
		{Model: "deepseek-chat"},
	},
	consts.ModelProviderMoonshot: {
		{Model: "moonshot-v1-auto"},
		{Model: "moonshot-v1-8k"},
		{Model: "moonshot-v1-32k"},
		{Model: "moonshot-v1-128k"},
	},
	consts.ModelProviderAzureOpenAI: {
		{Model: "gpt-4"},
		{Model: "gpt-4o"},
		{Model: "gpt-4o-mini"},
		{Model: "gpt-4o-nano"},
		{Model: "gpt-4.1"},
		{Model: "gpt-4.1-mini"},
		{Model: "gpt-4.1-nano"},
		{Model: "o1"},
		{Model: "o1-mini"},
		{Model: "o3"},
		{Model: "o3-mini"},
		{Model: "o4-mini"},
	},
	consts.ModelProviderVolcengine: {
		{Model: "doubao-seed-1.6-250615"},
		{Model: "doubao-seed-1.6-flash-250615"},
		{Model: "doubao-seed-1.6-thinking-250615"},
		{Model: "doubao-1.5-thinking-vision-pro-250428"},
		{Model: "deepseek-r1-250528"},
	},
}
