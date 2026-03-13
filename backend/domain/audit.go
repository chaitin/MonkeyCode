package domain

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

// AuditUsecase 审计日志业务逻辑接口
type AuditUsecase interface {
	CreateAudit(ctx context.Context, audit *Audit) error
	ListAudits(ctx context.Context, teamUser *TeamUser, req *ListAuditsRequest) (*ListAuditsResponse, error)
}

// AuditRepo 审计日志仓库接口
type AuditRepo interface {
	CreateAudit(ctx context.Context, audit *Audit) error
	ListAudits(ctx context.Context, teamUser *TeamUser, req *ListAuditsRequest) ([]*db.Audit, *db.Cursor, error)
}

// ListAuditsRequest 查询审计日志请求
type ListAuditsRequest struct {
	UserID         uuid.UUID `query:"user_id" json:"user_id,omitempty"`
	Operation      string    `query:"operation" json:"operation,omitempty"`
	SourceIP       string    `query:"source_ip" json:"source_ip,omitempty"`
	UserAgent      string    `query:"user_agent" json:"user_agent,omitempty"`
	Request        string    `query:"request" json:"request,omitempty"`
	Response       string    `query:"response" json:"response,omitempty"`
	CreatedAtStart time.Time `query:"created_at_start" json:"created_at_start"`
	CreatedAtEnd   time.Time `query:"created_at_end" json:"created_at_end"`
	CursorReq
}

// ListAuditsResponse 查询审计日志响应
type ListAuditsResponse struct {
	Audits []*Audit   `json:"audits"`
	Page   *db.Cursor `json:"page"`
}

// CreateAuditRequest 创建审计日志请求
type CreateAuditRequest struct {
	UserID    uuid.UUID `json:"user_id" binding:"required"`
	Operation string    `json:"operation" binding:"required"`
	SourceIP  string    `json:"source_ip" binding:"required"`
	UserAgent string    `json:"user_agent"`
	Request   string    `json:"request"`
	Response  string    `json:"response"`
}

// Audit 审计日志
type Audit struct {
	ID        uuid.UUID `json:"id"`
	Operation string    `json:"operation"`
	SourceIP  string    `json:"source_ip"`
	UserAgent string    `json:"user_agent"`
	Request   string    `json:"request"`
	Response  string    `json:"response"`
	CreatedAt time.Time `json:"created_at"`
	User      *User     `json:"user"`
}

// From 从 dbAudit 转换为 domain.Audit
func (a *Audit) From(src *db.Audit) *Audit {
	if src == nil {
		return nil
	}
	a.ID = src.ID
	a.Operation = src.Operation
	a.SourceIP = src.SourceIP
	a.UserAgent = src.UserAgent
	a.Request = src.Request
	a.Response = src.Response
	a.CreatedAt = src.CreatedAt

	if src.Edges.User != nil {
		a.User = cvt.From(src.Edges.User, &User{})
	}
	return a
}
