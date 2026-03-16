package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

// TeamImageUsecase 团队组镜像业务逻辑接口
type TeamImageUsecase interface {
	Add(ctx context.Context, teamUser *TeamUser, req *AddTeamImageReq) (*TeamImage, error)
	List(ctx context.Context, teamUser *TeamUser) (*ListTeamImagesResp, error)
	Update(ctx context.Context, teamUser *TeamUser, req *UpdateTeamImageReq) (*TeamImage, error)
	Delete(ctx context.Context, teamUser *TeamUser, req *DeleteTeamImageReq) error
}

// TeamImageRepo 团队镜像数据访问接口
type TeamImageRepo interface {
	List(ctx context.Context, teamUser *TeamUser) ([]*db.Image, error)
	Get(ctx context.Context, teamID, imageID uuid.UUID) (*db.Image, error)
	Create(ctx context.Context, teamID, userID uuid.UUID, req *AddTeamImageReq) (*db.Image, error)
	Update(ctx context.Context, teamID uuid.UUID, req *UpdateTeamImageReq) (*db.Image, error)
	Delete(ctx context.Context, teamID, imageID uuid.UUID) error
}

// TeamImage 团队镜像信息
type TeamImage struct {
	ID        uuid.UUID    `json:"id"`
	Name      string       `json:"name"`
	Remark    string       `json:"remark"`
	CreatedAt int64        `json:"created_at"`
	UpdatedAt int64        `json:"updated_at"`
	Groups    []*TeamGroup `json:"groups"`
}

// From 从数据库模型转换为领域模型
func (t *TeamImage) From(src *db.Image) *TeamImage {
	if src == nil {
		return t
	}

	t.ID = src.ID
	t.Name = src.Name
	t.Remark = src.Remark
	t.Groups = cvt.Iter(src.Edges.Groups, func(_ int, g *db.TeamGroup) *TeamGroup {
		return cvt.From(g, &TeamGroup{})
	})
	t.CreatedAt = src.CreatedAt.Unix()
	t.UpdatedAt = src.UpdatedAt.Unix()
	return t
}

// AddTeamImageReq 添加团队镜像请求
type AddTeamImageReq struct {
	Name     string      `json:"name" validate:"required"`
	Remark   string      `json:"remark"`
	GroupIDs []uuid.UUID `json:"group_ids" validate:"required"`
}

// ListTeamImagesResp 获取团队镜像列表响应
type ListTeamImagesResp struct {
	Images []*TeamImage `json:"images"`
}

// UpdateTeamImageReq 更新团队镜像请求
type UpdateTeamImageReq struct {
	ImageID  uuid.UUID   `param:"image_id" validate:"required" json:"-" swaggerignore:"true"`
	Name     string      `json:"name" validate:"omitempty"`
	Remark   string      `json:"remark" validate:"omitempty"`
	GroupIDs []uuid.UUID `json:"group_ids" validate:"omitempty"`
}

// DeleteTeamImageReq 删除团队镜像请求
type DeleteTeamImageReq struct {
	ImageID uuid.UUID `param:"image_id" validate:"required" json:"-" swaggerignore:"true"`
}

// GroupImageListReq 获取团队分组镜像列表请求
type GroupImageListReq struct {
	GroupID uuid.UUID `param:"group_id" validate:"required" json:"-" swaggerignore:"true"`
	CursorReq
}

// GroupImageListResp 获取团队分组镜像列表响应
type GroupImageListResp struct {
	Images []*Image   `json:"images"`
	Page   *db.Cursor `json:"page"`
}

// TeamGroupImage 团队分组镜像信息
type TeamGroupImage struct {
	GroupID   uuid.UUID `json:"group_id"`
	CreatedAt int64     `json:"created_at"`
	Image     *Image    `json:"image,omitempty"`
}

// From 从数据库模型转换为领域模型
func (t *TeamGroupImage) From(src *db.TeamGroupImage) *TeamGroupImage {
	if src == nil {
		return t
	}

	t.GroupID = src.GroupID
	t.CreatedAt = src.CreatedAt.Unix()
	if src.Edges.Image != nil {
		t.Image = cvt.From(src.Edges.Image, &Image{})
	}
	return t
}

// AddGroupImageReq 添加团队分组镜像请求
type AddGroupImageReq struct {
	GroupID uuid.UUID `param:"group_id" validate:"required" json:"-" swaggerignore:"true"`
	ImageID uuid.UUID `param:"image_id" validate:"required" json:"-" swaggerignore:"true"`
}

// DeleteGroupImageReq 删除团队分组镜像请求
type DeleteGroupImageReq struct {
	GroupID uuid.UUID `param:"group_id" validate:"required" json:"-" swaggerignore:"true"`
	ImageID uuid.UUID `param:"image_id" validate:"required" json:"-" swaggerignore:"true"`
}
