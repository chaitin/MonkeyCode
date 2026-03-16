package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
)

// ImageUsecase 镜像配置业务逻辑接口
type ImageUsecase interface {
	List(ctx context.Context, uid uuid.UUID, cursor CursorReq) (*ListImageResp, error)
	Create(ctx context.Context, uid uuid.UUID, req *CreateImageReq) (*Image, error)
	Delete(ctx context.Context, uid uuid.UUID, id uuid.UUID) error
	Update(ctx context.Context, uid uuid.UUID, id uuid.UUID, req *UpdateImageReq) (*Image, error)
}

// ImageRepo 镜像配置数据仓库接口
type ImageRepo interface {
	List(ctx context.Context, uid uuid.UUID, cursor CursorReq) ([]*db.Image, *db.Cursor, error)
	Create(ctx context.Context, uid uuid.UUID, req *CreateImageReq) (*db.Image, error)
	Delete(ctx context.Context, uid, id uuid.UUID) error
	Update(ctx context.Context, uid, id uuid.UUID, req *UpdateImageReq) (*db.Image, error)
	GetByID(ctx context.Context, id uuid.UUID, uid uuid.UUID) (*db.Image, error)
}

// Image 镜像配置信息
type Image struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Remark    string    `json:"remark"`
	IsDefault bool      `json:"is_default"`
	CreatedAt int64     `json:"created_at"`
	Owner     *Owner    `json:"owner"`
}

// From 从数据库模型转换为领域模型
func (i *Image) From(src *db.Image) *Image {
	if src == nil {
		return i
	}

	i.ID = src.ID
	i.Name = src.Name
	i.Remark = src.Remark
	i.CreatedAt = src.CreatedAt.Unix()

	if src.Edges.User == nil {
		return i
	}

	i.Owner = &Owner{
		ID:   src.Edges.User.ID.String(),
		Type: consts.OwnerTypePrivate,
		Name: src.Edges.User.Name,
	}

	if teams := src.Edges.User.Edges.Teams; src.Edges.User.Role == consts.UserRoleEnterprise && len(teams) > 0 {
		team := teams[0]
		i.Owner = &Owner{
			ID:   team.ID.String(),
			Type: consts.OwnerTypeTeam,
			Name: team.Name,
		}
		return i
	}

	if src.Edges.User.Role == consts.UserRoleAdmin {
		i.Owner = &Owner{
			ID:   src.Edges.User.ID.String(),
			Type: consts.OwnerTypePublic,
			Name: consts.MonkeyCodeAITeamName,
		}
		return i
	}
	return i
}

func (i *Image) GetIsDefault(user *db.User) bool {
	if defaultImageID, ok := user.DefaultConfigs[consts.DefaultConfigTypeImage]; ok {
		if defaultImageID.String() == i.ID.String() {
			return true
		}
	}
	return false
}

// ListImageResp 获取用户镜像配置列表响应
type ListImageResp struct {
	Images []*Image   `json:"images"`
	Page   *db.Cursor `json:"page"`
}

// CreateImageReq 创建镜像配置请求
type CreateImageReq struct {
	ImageName string `json:"image_name" validate:"required"`
	Remark    string `json:"remark,omitempty"`
	IsDefault bool   `json:"is_default,omitempty"`
}

// CreateImageResp 创建镜像配置响应
type CreateImageResp struct {
	ID uuid.UUID `json:"id"`
}

// DeleteImageReq 删除镜像配置请求
type DeleteImageReq struct {
	ID uuid.UUID `param:"id" validate:"required"`
}

// UpdateImageReq 更新镜像配置请求
type UpdateImageReq struct {
	ID        uuid.UUID `param:"id" validate:"required" json:"-" swaggerignore:"true"`
	ImageName *string   `json:"image_name,omitempty"`
	Remark    *string   `json:"remark,omitempty"`
	IsDefault *bool     `json:"is_default,omitempty"`
}

// Owner 资源所有者
type Owner struct {
	ID   string           `json:"id"`
	Type consts.OwnerType `json:"type"`
	Name string           `json:"name"`
}
