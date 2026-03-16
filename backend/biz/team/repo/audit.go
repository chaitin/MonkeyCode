package repo

import (
	"context"
	"errors"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/audit"
	"github.com/chaitin/MonkeyCode/backend/db/teammember"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
)

// AuditRepo 审计日志仓库
type AuditRepo struct {
	db *db.Client
}

// NewAuditRepo 创建审计日志仓库
func NewAuditRepo(i *do.Injector) (domain.AuditRepo, error) {
	return &AuditRepo{db: do.MustInvoke[*db.Client](i)}, nil
}

// CreateAudit 创建审计日志
func (r *AuditRepo) CreateAudit(ctx context.Context, a *domain.Audit) error {
	if a.User == nil {
		return errcode.ErrDatabaseOperation.Wrap(errors.New("user is nil"))
	}

	return r.db.Audit.Create().
		SetUserID(a.User.ID).
		SetOperation(a.Operation).
		SetSourceIP(a.SourceIP).
		SetUserAgent(a.UserAgent).
		SetRequest(a.Request).
		SetResponse(a.Response).
		Exec(ctx)
}

// ListAudits 查询审计日志
func (r *AuditRepo) ListAudits(ctx context.Context, teamUser *domain.TeamUser, req *domain.ListAuditsRequest) ([]*db.Audit, *db.Cursor, error) {
	var userIDs []uuid.UUID
	err := r.db.TeamMember.Query().
		Where(teammember.TeamIDEQ(teamUser.GetTeamID())).
		Select(teammember.FieldUserID).
		Scan(ctx, &userIDs)
	if err != nil {
		return nil, nil, err
	}

	query := r.db.Audit.Query().Where(audit.UserIDIn(userIDs...))
	if req.UserID != uuid.Nil {
		query = query.Where(audit.UserIDEQ(req.UserID))
	}
	if req.Operation != "" {
		query = query.Where(audit.OperationEQ(req.Operation))
	}
	if req.SourceIP != "" {
		query = query.Where(audit.SourceIPEQ(req.SourceIP))
	}
	if req.UserAgent != "" {
		query = query.Where(audit.UserAgentEQ(req.UserAgent))
	}
	if req.Request != "" {
		query = query.Where(audit.RequestContains(req.Request))
	}
	if req.Response != "" {
		query = query.Where(audit.ResponseContains(req.Response))
	}
	if !req.CreatedAtStart.IsZero() {
		query = query.Where(audit.CreatedAtGTE(req.CreatedAtStart))
	}
	if !req.CreatedAtEnd.IsZero() {
		query = query.Where(audit.CreatedAtLTE(req.CreatedAtEnd))
	}

	data, cursor, err := query.
		Order(audit.ByCreatedAt(sql.OrderDesc())).
		WithUser(func(q *db.UserQuery) { q.WithTeams() }).
		After(ctx, req.Cursor, req.Limit)
	if err != nil {
		return nil, nil, err
	}
	return data, cursor, nil
}
