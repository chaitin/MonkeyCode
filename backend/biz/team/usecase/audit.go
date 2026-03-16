package usecase

import (
	"context"

	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

// AuditUsecase 审计日志业务逻辑
type AuditUsecase struct {
	repo domain.AuditRepo
}

// NewAuditUsecase 创建审计日志业务逻辑
func NewAuditUsecase(i *do.Injector) (domain.AuditUsecase, error) {
	return &AuditUsecase{
		repo: do.MustInvoke[domain.AuditRepo](i),
	}, nil
}

// CreateAudit 创建审计日志
func (u *AuditUsecase) CreateAudit(ctx context.Context, audit *domain.Audit) error {
	return u.repo.CreateAudit(ctx, audit)
}

// ListAudits 查询审计日志列表
func (u *AuditUsecase) ListAudits(ctx context.Context, teamUser *domain.TeamUser, req *domain.ListAuditsRequest) (*domain.ListAuditsResponse, error) {
	audits, cursor, err := u.repo.ListAudits(ctx, teamUser, req)
	if err != nil {
		return nil, err
	}

	return &domain.ListAuditsResponse{
		Audits: cvt.Iter(audits, func(i int, src *db.Audit) *domain.Audit {
			return cvt.From(src, &domain.Audit{})
		}),
		Page: cursor,
	}, nil
}
