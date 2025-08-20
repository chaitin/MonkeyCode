package domain

import (
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
)

type GrantRoleReq struct {
	AdminID uuid.UUID `json:"admin_id"` // 管理员ID
	RoleIDs []int64   `json:"role_ids"` // 角色ID列表
}

type Role struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (r *Role) From(e *db.Role) *Role {
	if e == nil {
		return r
	}
	r.ID = e.ID
	r.Name = e.Name
	r.Description = e.Description
	return r
}
