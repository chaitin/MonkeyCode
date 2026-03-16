package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

// TeamModelUsecase 团队模型配置业务逻辑接口
type TeamModelUsecase interface {
	Add(ctx context.Context, teamUser *TeamUser, req *AddTeamModelReq) (*TeamModel, error)
	List(ctx context.Context, teamUser *TeamUser) (*ListTeamModelsResp, error)
	Update(ctx context.Context, teamUser *TeamUser, req *UpdateTeamModelReq) (*TeamModel, error)
	Delete(ctx context.Context, teamUser *TeamUser, req *DeleteTeamModelReq) error
	Check(ctx context.Context, teamUser *TeamUser, id uuid.UUID) (*CheckModelResp, error)
	CheckByConfig(ctx context.Context, req *CheckByConfigReq) (*CheckModelResp, error)
}

// TeamModelRepo 团队模型配置数据访问接口
type TeamModelRepo interface {
	List(ctx context.Context, teamID uuid.UUID) ([]*db.Model, error)
	Get(ctx context.Context, teamID, modelID uuid.UUID) (*db.Model, error)
	Create(ctx context.Context, teamID, userID uuid.UUID, req *AddTeamModelReq) (*db.Model, error)
	Update(ctx context.Context, teamID uuid.UUID, req *UpdateTeamModelReq) (*db.Model, error)
	Delete(ctx context.Context, teamID, modelID uuid.UUID) error
	UpdateCheckResult(ctx context.Context, id uuid.UUID, success bool, errMsg string) error
}

// TeamModel 团队模型配置信息
type TeamModel struct {
	ID               uuid.UUID            `json:"id"`
	Provider         string               `json:"provider"`
	APIKey           string               `json:"api_key"`
	BaseURL          string               `json:"base_url"`
	Model            string               `json:"model"`
	Temperature      float64              `json:"temperature"`
	InterfaceType    consts.InterfaceType `json:"interface_type"`
	CreatedAt        int64                `json:"created_at"`
	UpdatedAt        int64                `json:"updated_at"`
	Groups           []*TeamGroup         `json:"groups"`
	LastCheckAt      int64                `json:"last_check_at"`
	LastCheckSuccess bool                 `json:"last_check_success"`
	LastCheckError   string               `json:"last_check_error"`
}

// From 从数据库模型转换为领域模型
func (t *TeamModel) From(src *db.Model) *TeamModel {
	if src == nil {
		return t
	}

	t.ID = src.ID
	t.Provider = src.Provider
	t.BaseURL = src.BaseURL
	t.Model = src.Model
	t.Temperature = src.Temperature
	t.Groups = cvt.Iter(src.Edges.Groups, func(_ int, g *db.TeamGroup) *TeamGroup {
		return cvt.From(g, &TeamGroup{})
	})
	t.InterfaceType = consts.InterfaceType(src.InterfaceType)
	t.LastCheckSuccess = src.LastCheckSuccess
	t.LastCheckError = src.LastCheckError
	t.CreatedAt = src.CreatedAt.Unix()
	t.UpdatedAt = src.UpdatedAt.Unix()
	t.LastCheckAt = src.LastCheckAt.Unix()
	return t
}

// AddTeamModelReq 添加团队模型配置请求
type AddTeamModelReq struct {
	Provider      string               `json:"provider" validate:"required"`
	APIKey        string               `json:"api_key" validate:"required"`
	BaseURL       string               `json:"base_url" validate:"required"`
	Model         string               `json:"model" validate:"required"`
	Temperature   float64              `json:"temperature"`
	GroupIDs      []uuid.UUID          `json:"group_ids" validate:"required"`
	InterfaceType consts.InterfaceType `json:"interface_type" validate:"required,oneof=openai_chat openai_responses anthropic"`
}

// ListTeamModelsResp 获取团队模型配置列表响应
type ListTeamModelsResp struct {
	Models []*TeamModel `json:"models"`
}

// UpdateTeamModelReq 更新团队模型配置请求
type UpdateTeamModelReq struct {
	ModelID       uuid.UUID            `param:"model_id" validate:"required" json:"-" swaggerignore:"true"`
	Provider      string               `json:"provider" validate:"omitempty"`
	APIKey        string               `json:"api_key" validate:"omitempty"`
	BaseURL       string               `json:"base_url" validate:"omitempty"`
	Model         string               `json:"model" validate:"omitempty"`
	Temperature   float64              `json:"temperature" validate:"omitempty"`
	GroupIDs      []uuid.UUID          `json:"group_ids" validate:"omitempty"`
	InterfaceType consts.InterfaceType `json:"interface_type" validate:"omitempty,oneof=openai_chat openai_responses anthropic"`
}

// DeleteTeamModelReq 删除团队模型配置请求
type DeleteTeamModelReq struct {
	ModelID uuid.UUID `param:"model_id" validate:"required" json:"-" swaggerignore:"true"`
}

// GroupModelListReq 获取团队分组模型配置列表请求
type GroupModelListReq struct {
	GroupID uuid.UUID `param:"group_id" validate:"required" json:"-" swaggerignore:"true"`
	CursorReq
}

// GroupModelListResp 获取团队分组模型配置列表响应
type GroupModelListResp struct {
	Models []*Model   `json:"models"`
	Page   *db.Cursor `json:"page"`
}

// TeamGroupModel 团队分组模型配置信息
type TeamGroupModel struct {
	GroupID   uuid.UUID `json:"group_id"`
	CreatedAt int64     `json:"created_at"`
	Model     *Model    `json:"model,omitempty"`
}

// From 从数据库模型转换为领域模型
func (t *TeamGroupModel) From(src *db.TeamGroupModel) *TeamGroupModel {
	if src == nil {
		return t
	}

	t.GroupID = src.GroupID
	t.CreatedAt = src.CreatedAt.Unix()
	if src.Edges.Model != nil {
		t.Model = cvt.From(src.Edges.Model, &Model{})
	}
	return t
}

// AddGroupModelReq 添加团队分组模型配置请求
type AddGroupModelReq struct {
	GroupID uuid.UUID `param:"group_id" validate:"required" json:"-" swaggerignore:"true"`
	ModelID uuid.UUID `param:"model_id" validate:"required" json:"-" swaggerignore:"true"`
}

// DeleteGroupModelReq 删除团队分组模型配置请求
type DeleteGroupModelReq struct {
	GroupID uuid.UUID `param:"group_id" validate:"required" json:"-" swaggerignore:"true"`
	ModelID uuid.UUID `param:"model_id" validate:"required" json:"-" swaggerignore:"true"`
}
