package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// TeamHostUsecase 团队宿主机业务逻辑接口
type TeamHostUsecase interface {
	GetInstallCommand(ctx context.Context, teamUser *TeamUser) (string, error)
	List(ctx context.Context, teamUser *TeamUser) (*ListTeamHostsResp, error)
	Delete(ctx context.Context, teamUser *TeamUser, req *DeleteTeamHostReq) error
	Update(ctx context.Context, teamUser *TeamUser, req *UpdateTeamHostReq) (*Host, error)
}

// TeamHostRepo 团队宿主机数据访问接口
type TeamHostRepo interface {
	List(ctx context.Context, teamID uuid.UUID) ([]*db.Host, error)
	Delete(ctx context.Context, teamUser *TeamUser, hostID string) error
	UpsertHost(ctx context.Context, user *User, info *taskflow.Host) error
	Update(ctx context.Context, teamUser *TeamUser, req *UpdateTeamHostReq) (*db.Host, error)
}

// UpdateTeamHostReq 更新团队宿主机请求
type UpdateTeamHostReq struct {
	HostID   string      `param:"host_id" validate:"required" json:"-" swaggerignore:"true"`
	GroupIDs []uuid.UUID `json:"group_ids" validate:"omitempty"`
	Remark   string      `json:"remark,omitempty"`
}

// ListTeamHostsResp 团队宿主机列表响应
type ListTeamHostsResp struct {
	Hosts []*Host `json:"hosts"`
}

// DeleteTeamHostReq 删除团队宿主机请求
type DeleteTeamHostReq struct {
	HostID string `param:"host_id" validate:"required" json:"-" swaggerignore:"true"`
}

// TeamGroupHost 团队分组宿主机信息
type TeamGroupHost struct {
	GroupID   uuid.UUID `json:"group_id"`
	CreatedAt int64     `json:"created_at"`
	Host      *Host     `json:"host,omitempty"`
}

// From 从数据库模型转换
func (t *TeamGroupHost) From(src *db.TeamGroupHost) *TeamGroupHost {
	if src == nil {
		return t
	}
	t.GroupID = src.GroupID
	t.CreatedAt = src.CreatedAt.Unix()
	t.Host = cvt.From(src.Edges.Host, &Host{})
	return t
}
