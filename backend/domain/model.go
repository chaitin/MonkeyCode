package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
)

type ModelUsecase interface {
	List(ctx context.Context) (*AllModelResp, error)
	MyModelList(ctx context.Context, req *MyModelListReq) ([]*Model, error)
	Create(ctx context.Context, req *CreateModelReq) (*Model, error)
	Update(ctx context.Context, req *UpdateModelReq) (*Model, error)
	Delete(ctx context.Context, id string) error
	GetTokenUsage(ctx context.Context, modelType consts.ModelType) (*ModelTokenUsageResp, error)
	InitModel(ctx context.Context) error
}

type ModelRepo interface {
	GetWithCache(ctx context.Context, modelType consts.ModelType) (*db.Model, error)
	List(ctx context.Context) (*AllModelResp, error)
	Create(ctx context.Context, m *CreateModelReq) (*db.Model, error)
	Update(ctx context.Context, id string, fn func(tx *db.Tx, old *db.Model, up *db.ModelUpdateOne) error) (*db.Model, error)
	Delete(ctx context.Context, id string) error
	MyModelList(ctx context.Context, req *MyModelListReq) ([]*db.Model, error)
	ModelUsage(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]ModelUsage, error)
	GetTokenUsage(ctx context.Context, modelType consts.ModelType) (*ModelTokenUsageResp, error)
	InitModel(ctx context.Context, modelName, modelKey, modelURL string) error
}

type MyModelListReq struct {
	ModelType consts.ModelType `json:"model_type" query:"model_type"` // 模型类型 llm:对话模型 coder:代码模型
}

type CheckModelReq struct {
	Type       consts.ModelType     `json:"type" validate:"required,oneof=llm coder embedding rerank"`
	Provider   consts.ModelProvider `json:"provider" validate:"required"`   // 提供商
	ModelName  string               `json:"model_name" validate:"required"` // 模型名称
	APIBase    string               `json:"api_base" validate:"required"`   // 接口地址
	APIKey     string               `json:"api_key"`                        // 接口密钥
	APIVersion string               `json:"api_version"`
	APIHeader  string               `json:"api_header"`
}

type GetProviderModelListReq struct {
	Provider  consts.ModelProvider `json:"provider" query:"provider" validate:"required,oneof=SiliconFlow OpenAI Ollama DeepSeek Moonshot AzureOpenAI BaiZhiCloud Hunyuan BaiLian Volcengine ZhiPu Gemini Other"`
	BaseURL   string               `json:"base_url" query:"base_url" validate:"required"`
	APIKey    string               `json:"api_key" query:"api_key"`
	APIHeader string               `json:"api_header" query:"api_header"`
	Type      consts.ModelType     `json:"type" query:"type" validate:"required,oneof=llm coder embedding rerank"`
}

type GetProviderModelListResp struct {
	Models []ProviderModelListItem `json:"models"`
}

type ProviderModelListItem struct {
	Model string `json:"model"`
}

type AllModelResp struct {
	Providers []ProviderModel `json:"providers"` // 提供商列表
}

type ProviderModel struct {
	Provider string       `json:"provider"` // 提供商
	Models   []ModelBasic `json:"models"`   // 模型列表
}

type GetTokenUsageReq struct {
	ModelType consts.ModelType `json:"model_type" query:"model_type" validate:"required,oneof=llm coder"` // 模型类型 llm:对话模型 coder:代码模型
}

type CreateModelReq struct {
	AdminID    uuid.UUID            `json:"-"`
	ShowName   string               `json:"show_name"`                                                                                                                                            // 模型显示名称
	ModelName  string               `json:"model_name" validate:"required"`                                                                                                                       // 模型名称 如: deepseek-v3
	Provider   consts.ModelProvider `json:"provider" validate:"required,oneof=SiliconFlow OpenAI Ollama DeepSeek Moonshot AzureOpenAI BaiZhiCloud Hunyuan BaiLian Volcengine ZhiPu Gemini Other"` // 提供商
	APIBase    string               `json:"api_base" validate:"required"`                                                                                                                         // 接口地址 如：https://api.qwen.com
	APIKey     string               `json:"api_key"`                                                                                                                                              // 接口密钥 如：sk-xxxx
	APIVersion string               `json:"api_version"`
	APIHeader  string               `json:"api_header"`
	ModelType  consts.ModelType     `json:"model_type"` // 模型类型 llm:对话模型 coder:代码模型
	Param      *ModelParam          `json:"param"`      // 高级参数
}

type ModelParam struct {
	R1Enabled          bool `json:"r1_enabled"`
	MaxTokens          int  `json:"max_tokens"`
	ContextWindow      int  `json:"context_window"`
	SupprtImages       bool `json:"support_images"`
	SupportComputerUse bool `json:"support_computer_use"`
	SupportPromptCache bool `json:"support_prompt_cache"`
}

func DefaultModelParam() *ModelParam {
	return &ModelParam{
		R1Enabled:          false,
		MaxTokens:          8192,
		ContextWindow:      64000,
		SupprtImages:       false,
		SupportComputerUse: false,
		SupportPromptCache: false,
	}
}

type UpdateModelReq struct {
	ID         string                `json:"id"`                                                                                                                                                   // 模型ID
	ModelName  *string               `json:"model_name"`                                                                                                                                           // 模型名称
	ShowName   *string               `json:"show_name"`                                                                                                                                            // 模型显示名称
	Provider   *consts.ModelProvider `json:"provider" validate:"required,oneof=SiliconFlow OpenAI Ollama DeepSeek Moonshot AzureOpenAI BaiZhiCloud Hunyuan BaiLian Volcengine ZhiPu Gemini Other"` // 提供商
	APIBase    *string               `json:"api_base"`                                                                                                                                             // 接口地址 如：https://api.qwen.com
	APIKey     *string               `json:"api_key"`                                                                                                                                              // 接口密钥 如：sk-xxxx
	APIVersion *string               `json:"api_version"`
	APIHeader  *string               `json:"api_header"`
	Status     *consts.ModelStatus   `json:"status"`          // 状态 active:启用 inactive:禁用
	Param      *ModelParam           `json:"param,omitempty"` // 高级参数
}

type ModelTokenUsageResp struct {
	TotalInput  int64             `json:"total_input"`  // 总输入token数
	TotalOutput int64             `json:"total_output"` // 总输出token数
	InputUsage  []ModelTokenUsage `json:"input_usage"`  // 输入token使用记录
	OutputUsage []ModelTokenUsage `json:"output_usage"` // 输出token使用记录
}

type ModelTokenUsage struct {
	Timestamp int64 `json:"timestamp"` // 时间戳
	Tokens    int64 `json:"tokens"`    // 使用token数
}

type ModelBasic struct {
	Name     string               `json:"name"`                                                                                                                                                 // 模型名称
	Provider consts.ModelProvider `json:"provider" validate:"required,oneof=SiliconFlow OpenAI Ollama DeepSeek Moonshot AzureOpenAI BaiZhiCloud Hunyuan BaiLian Volcengine ZhiPu Gemini Other"` // 提供商
	APIBase  string               `json:"api_base"`                                                                                                                                             // 接口地址 如：https://api.qwen.com
}

type ModelUsage struct {
	ModelID uuid.UUID `json:"model_id"` // 模型ID
	Input   int64     `json:"input"`    // 输入token数
	Output  int64     `json:"output"`   // 输出token数
}

type Model struct {
	ID         string               `json:"id"`          // 模型ID
	ShowName   string               `json:"show_name"`   // 模型显示名称
	ModelName  string               `json:"model_name"`  // 模型名称 如: deepseek-v3
	Provider   consts.ModelProvider `json:"provider"`    // 提供商
	APIBase    string               `json:"api_base"`    // 接口地址 如：https://api.qwen.com
	APIKey     string               `json:"api_key"`     // 接口密钥 如：sk-xxxx
	APIVersion string               `json:"api_version"` // 接口版本 如：2023-05-15
	APIHeader  string               `json:"api_header"`  // 接口头 如：Authorization: Bearer sk-xxxx
	ModelType  consts.ModelType     `json:"model_type"`  // 模型类型 llm:对话模型 coder:代码模型
	Status     consts.ModelStatus   `json:"status"`      // 状态 active:启用 inactive:禁用
	IsActive   bool                 `json:"is_active"`   // 是否启用
	Input      int64                `json:"input"`       // 输入token数
	Output     int64                `json:"output"`      // 输出token数
	Param      ModelParam           `json:"param"`       // 高级参数
	IsInternal bool                 `json:"is_internal"` // 是否内部模型
	CreatedAt  int64                `json:"created_at"`  // 创建时间
	UpdatedAt  int64                `json:"updated_at"`  // 更新时间
}

func (m *Model) From(e *db.Model) *Model {
	if e == nil {
		return m
	}

	m.ID = e.ID.String()
	m.ShowName = e.ShowName
	m.ModelName = e.ModelName
	m.Provider = e.Provider
	m.APIBase = e.APIBase
	m.APIKey = e.APIKey
	m.APIVersion = e.APIVersion
	m.APIHeader = e.APIHeader
	m.ModelType = e.ModelType
	m.Status = e.Status
	m.IsInternal = e.IsInternal
	m.IsActive = e.Status == consts.ModelStatusActive
	if p := e.Parameters; p != nil {
		m.Param = ModelParam{
			R1Enabled:          p.R1Enabled,
			MaxTokens:          p.MaxTokens,
			ContextWindow:      p.ContextWindow,
			SupprtImages:       p.SupprtImages,
			SupportComputerUse: p.SupportComputerUse,
			SupportPromptCache: p.SupportPromptCache,
		}
	}
	m.CreatedAt = e.CreatedAt.Unix()
	m.UpdatedAt = e.UpdatedAt.Unix()

	return m
}

type CheckModelResp struct {
	Error   string `json:"error"`
	Content string `json:"content"`
}
