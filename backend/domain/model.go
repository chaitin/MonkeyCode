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
	Check(ctx context.Context, req *CheckModelReq) (*Model, error)
	GetTokenUsage(ctx context.Context, modelType consts.ModelType) (*ModelTokenUsageResp, error)
}

type ModelRepo interface {
	Create(ctx context.Context, m *CreateModelReq) (*db.Model, error)
	Update(ctx context.Context, id string, fn func(up *db.ModelUpdateOne)) (*db.Model, error)
	MyModelList(ctx context.Context, req *MyModelListReq) ([]*db.Model, error)
	ModelUsage(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]ModelUsage, error)
	GetTokenUsage(ctx context.Context, modelType consts.ModelType) (*ModelTokenUsageResp, error)
}

type MyModelListReq struct {
	UserID    string           `json:"-"`
	ModelType consts.ModelType `json:"model_type" query:"model_type"` // 模型类型 llm:对话模型 coder:代码模型
}

type CheckModelReq struct {
	Provider  string `json:"provider" validate:"required"`   // 提供商
	ModelName string `json:"model_name" validate:"required"` // 模型名称
	APIBase   string `json:"api_base" validate:"required"`   // 接口地址
	APIKey    string `json:"api_key" validate:"required"`    // 接口密钥
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
	UserID    string           `json:"-"`
	ModelName string           `json:"model_name"` // 模型名称 如: deepseek-v3
	Provider  string           `json:"provider"`   // 提供商
	APIBase   string           `json:"api_base"`   // 接口地址 如：https://api.qwen.com
	APIKey    string           `json:"api_key"`    // 接口密钥 如：sk-xxxx
	ModelType consts.ModelType `json:"model_type"` // 模型类型 llm:对话模型 coder:代码模型
}

type UpdateModelReq struct {
	ID        string              `json:"id"`         // 模型ID
	ModelName *string             `json:"model_name"` // 模型名称
	Provider  *string             `json:"provider"`   // 提供商
	APIBase   *string             `json:"api_base"`   // 接口地址 如：https://api.qwen.com
	APIKey    *string             `json:"api_key"`    // 接口密钥 如：sk-xxxx
	Status    *consts.ModelStatus `json:"status"`     // 状态 active:启用 inactive:禁用
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
	Name     string `json:"name"`     // 模型名称
	Provider string `json:"provider"` // 提供商
	APIBase  string `json:"api_base"` // 接口地址 如：https://api.qwen.com
}

type ModelUsage struct {
	ModelID uuid.UUID `json:"model_id"` // 模型ID
	Input   int64     `json:"input"`    // 输入token数
	Output  int64     `json:"output"`   // 输出token数
}

type Model struct {
	ID        string             `json:"id"`         // 模型ID
	ModelName string             `json:"model_name"` // 模型名称 如: deepseek-v3
	Provider  string             `json:"provider"`   // 提供商
	APIBase   string             `json:"api_base"`   // 接口地址 如：https://api.qwen.com
	APIKey    string             `json:"api_key"`    // 接口密钥 如：sk-xxxx
	ModelType consts.ModelType   `json:"model_type"` // 模型类型 llm:对话模型 coder:代码模型
	Status    consts.ModelStatus `json:"status"`     // 状态 active:启用 inactive:禁用
	IsActive  bool               `json:"is_active"`  // 是否启用
	Input     int64              `json:"input"`      // 输入token数
	Output    int64              `json:"output"`     // 输出token数
	CreatedAt int64              `json:"created_at"` // 创建时间
	UpdatedAt int64              `json:"updated_at"` // 更新时间
}

func (m *Model) From(e *db.Model) *Model {
	if e == nil {
		return m
	}

	m.ID = e.ID.String()
	m.ModelName = e.ModelName
	m.Provider = e.Provider
	m.APIBase = e.APIBase
	m.APIKey = e.APIKey
	m.ModelType = e.ModelType
	m.Status = e.Status
	m.IsActive = e.Status == consts.ModelStatusActive
	m.CreatedAt = e.CreatedAt.Unix()
	m.UpdatedAt = e.UpdatedAt.Unix()

	return m
}
