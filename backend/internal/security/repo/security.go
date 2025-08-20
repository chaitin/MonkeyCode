package repo

import (
	"context"
	"fmt"
	"strings"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/securityscanning"
	"github.com/chaitin/MonkeyCode/backend/db/securityscanningresult"
	"github.com/chaitin/MonkeyCode/backend/db/workspace"
	"github.com/chaitin/MonkeyCode/backend/db/workspacefile"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/ent/rule"
	"github.com/chaitin/MonkeyCode/backend/ent/types"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/scan"
)

type SecurityScanningRepo struct {
	db *db.Client
}

func NewSecurityScanningRepo(db *db.Client) domain.SecurityScanningRepo {
	return &SecurityScanningRepo{
		db: db,
	}
}

// Create implements domain.SecurityScanningRepo.
func (s *SecurityScanningRepo) Create(ctx context.Context, req domain.CreateSecurityScanningReq) (string, error) {
	id := uuid.New()
	uid, err := uuid.Parse(req.UserID)
	if err != nil {
		return "", err
	}

	w, err := s.db.Workspace.Query().
		Where(workspace.UserID(uid)).
		Where(workspace.RootPath(req.Workspace)).
		First(ctx)
	if err != nil {
		return "", err
	}

	_, err = s.db.SecurityScanning.Create().
		SetID(id).
		SetUserID(uid).
		SetWorkspaceID(w.ID).
		SetLanguage(req.Language).
		SetRule(req.Language.RuleName()).
		SetWorkspace(req.Workspace).
		SetStatus(consts.SecurityScanningStatusPending).
		Save(ctx)

	if err != nil {
		return "", err
	}

	return id.String(), nil
}

// Update implements domain.SecurityScanningRepo.
func (s *SecurityScanningRepo) Update(ctx context.Context, id string, fileMap map[string]string, status consts.SecurityScanningStatus, result *scan.Result) error {
	uid, err := uuid.Parse(id)
	if err != nil {
		return err
	}

	return entx.WithTx(ctx, s.db, func(tx *db.Tx) error {
		up := s.db.SecurityScanning.Update().
			Where(securityscanning.ID(uid)).
			SetStatus(status)

		if result != nil && result.Output != "" {
			up.SetErrorMessage(result.Output)
		}

		if err := up.Exec(ctx); err != nil {
			return err
		}

		if result == nil {
			return nil
		}

		cs := make([]*db.SecurityScanningResultCreate, 0)
		for _, item := range result.Results {
			c := s.db.SecurityScanningResult.Create().
				SetSecurityScanningID(uid).
				SetCheckID(item.CheckID).
				SetEngineKind(item.Extra.EngineKind).
				SetLines(item.Extra.Lines).
				SetMessage(item.Extra.Message).
				SetMessageZh(item.Extra.Metadata.MessageZh).
				SetSeverity(item.Extra.Severity).
				SetAbstractEn(item.Extra.Metadata.AbstractFeysh["en-US"]).
				SetAbstractZh(item.Extra.Metadata.AbstractFeysh["zh-CN"]).
				SetCategoryEn(item.Extra.Metadata.CategoryFeysh["en-US"]).
				SetCategoryZh(item.Extra.Metadata.CategoryFeysh["zh-CN"]).
				SetConfidence(item.Extra.Metadata.Confidence).
				SetCwe([]any{item.Extra.Metadata.Cwe}).
				SetImpact(item.Extra.Metadata.Impact).
				SetOwasp([]any{item.Extra.Metadata.Owasp}).
				SetPath(strings.ReplaceAll(item.Path, result.Prefix, "")).
				SetFileContent(fileMap[item.Path]).
				SetStartPosition(&types.Position{
					Col:    item.Start.Col,
					Line:   item.Start.Line,
					Offset: item.Start.Offset,
				}).
				SetEndPosition(&types.Position{
					Col:    item.End.Col,
					Line:   item.End.Line,
					Offset: item.End.Offset,
				})
			cs = append(cs, c)
			if len(cs) >= 10 {
				if err := s.db.SecurityScanningResult.CreateBulk(cs...).Exec(ctx); err != nil {
					return err
				}
				cs = cs[:0]
			}
		}

		if len(cs) > 0 {
			if err := s.db.SecurityScanningResult.CreateBulk(cs...).Exec(ctx); err != nil {
				return err
			}
		}

		return nil
	})
}

// List implements domain.SecurityScanningRepo.
func (s *SecurityScanningRepo) List(ctx context.Context, req domain.ListSecurityScanningReq) (*domain.ListSecurityScanningResp, error) {
	query := s.db.SecurityScanning.Query().
		WithResults().
		WithUser()

	if req.UserID != "" {
		uid, err := uuid.Parse(req.UserID)
		if err != nil {
			return nil, err
		}
		query.Where(securityscanning.UserID(uid))
	}

	scannings, p, err := query.
		Order(db.Desc("created_at")).
		Page(ctx, int(req.Page), int(req.Size))

	if err != nil {
		return nil, err
	}

	ids := cvt.Iter(scannings, func(_ int, s *db.SecurityScanning) uuid.UUID {
		return s.ID
	})
	riskCount, err := s.RiskCountByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}

	return &domain.ListSecurityScanningResp{
		PageInfo: p,
		Items: cvt.Iter(scannings, func(_ int, s *db.SecurityScanning) *domain.SecurityScanningResult {
			return cvt.From(s, &domain.SecurityScanningResult{
				Risk: riskCount[s.ID],
			})
		}),
	}, nil
}

// ListBrief implements domain.SecurityScanningRepo.
func (s *SecurityScanningRepo) ListBrief(ctx context.Context, req domain.ListSecurityScanningReq) (*domain.ListSecurityScanningBriefResp, error) {
	query := s.db.SecurityScanning.Query().
		WithUser().
		WithResults()

	if req.UserID != "" {
		uid, err := uuid.Parse(req.UserID)
		if err != nil {
			return nil, err
		}
		query.Where(securityscanning.UserID(uid))
	}

	scannings, p, err := query.
		Order(securityscanning.ByCreatedAt(sql.OrderDesc())).
		Page(ctx, int(req.Page), int(req.Size))

	if err != nil {
		return nil, err
	}

	return &domain.ListSecurityScanningBriefResp{
		PageInfo: p,
		Items: cvt.Iter(scannings, func(_ int, s *db.SecurityScanning) *domain.SecurityScanningBrief {
			return cvt.From(s, &domain.SecurityScanningBrief{
				ReportURL: fmt.Sprintf("%s/user/codescan", req.BaseURL),
			})
		}),
	}, nil
}

func (s *SecurityScanningRepo) Detail(ctx context.Context, userID, id string) ([]*domain.SecurityScanningRiskDetail, error) {
	sid, err := uuid.Parse(id)
	if err != nil {
		return nil, err
	}

	q := s.db.SecurityScanningResult.Query().
		Where(securityscanningresult.SecurityScanningID(sid)).
		Order(
			BySeverityOrder(),
			securityscanningresult.ByCreatedAt(sql.OrderDesc()),
		)

	if userID != "" {
		uid, err := uuid.Parse(userID)
		if err != nil {
			return nil, err
		}
		q.Where(securityscanningresult.HasSecurityScanningWith(func(s *sql.Selector) {
			s.Where(sql.EQ(securityscanning.FieldUserID, uid))
		}))
	}

	scannings, err := q.All(ctx)
	if err != nil {
		return nil, err
	}

	rs := cvt.Iter(scannings, func(_ int, r *db.SecurityScanningResult) *domain.SecurityScanningRiskDetail {
		return cvt.From(r, &domain.SecurityScanningRiskDetail{})
	})
	return rs, nil
}

// RiskCountByIDs implements domain.SecurityScanningRepo.
func (s *SecurityScanningRepo) RiskCountByIDs(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]domain.SecurityScanningRiskResult, error) {
	rs := make([]domain.SecurityScanningRiskResult, 0)
	if err := s.db.SecurityScanningResult.Query().
		Where(securityscanningresult.SecurityScanningIDIn(ids...)).
		Modify(func(s *sql.Selector) {
			s.Select(
				sql.As("security_scanning_id", "id"),
				sql.As("count(*) filter (where severity in ('CRITICAL', 'ERROR'))", "severe_count"),
				sql.As("count(*) filter (where severity = 'WARNING')", "critical_count"),
				sql.As("count(*) filter (where severity = 'INFO')", "suggest_count"),
			).
				GroupBy(securityscanningresult.FieldSecurityScanningID)
		}).
		Scan(ctx, &rs); err != nil {
		return nil, err
	}
	return cvt.IterToMap(rs, func(_ int, r domain.SecurityScanningRiskResult) (uuid.UUID, domain.SecurityScanningRiskResult) {
		return r.ID, r
	}), nil
}

// AllRunning implements domain.SecurityScanningRepo.
func (s *SecurityScanningRepo) AllRunning(ctx context.Context) ([]*db.SecurityScanning, error) {
	ctx = rule.SkipPermission(ctx)
	return s.db.SecurityScanning.Query().
		Where(securityscanning.Status(consts.SecurityScanningStatusRunning)).
		Order(securityscanning.ByCreatedAt(sql.OrderAsc())).
		All(ctx)
}

func (s *SecurityScanningRepo) Get(ctx context.Context, id string) (*db.SecurityScanning, error) {
	sid, err := uuid.Parse(id)
	if err != nil {
		return nil, err
	}
	return s.db.SecurityScanning.Query().
		WithWorkspaceEdge().
		Where(securityscanning.ID(sid)).
		First(ctx)
}

// PageWorkspaceFiles implements domain.SecurityScanningRepo.
func (s *SecurityScanningRepo) PageWorkspaceFiles(ctx context.Context, id string, size int, fn func([]*db.WorkspaceFile) error) error {
	wid, err := uuid.Parse(id)
	if err != nil {
		return err
	}

	page := 1
	hasMore := true

	for hasMore {
		rs, p, err := s.db.WorkspaceFile.Query().
			Where(workspacefile.WorkspaceID(wid)).
			Order(workspacefile.ByCreatedAt(sql.OrderAsc())).
			Page(ctx, page, size)
		if err != nil {
			return err
		}
		if err := fn(rs); err != nil {
			return err
		}
		hasMore = p.HasNextPage
		page++
	}

	return nil
}

func (s *SecurityScanningRepo) ListDetail(ctx context.Context, req domain.ListSecurityScanningDetailReq) (*domain.ListSecurityScanningDetailResp, error) {
	sid, err := uuid.Parse(req.ID)
	if err != nil {
		return nil, err
	}
	q := s.db.SecurityScanningResult.Query().
		Where(securityscanningresult.SecurityScanningID(sid)).
		Order(
			BySeverityOrder(),
			securityscanningresult.ByCreatedAt(sql.OrderDesc()),
			securityscanningresult.ByID(sql.OrderDesc()),
		)

	rs, p, err := q.Page(ctx, req.Page, req.Size)
	if err != nil {
		return nil, err
	}

	return &domain.ListSecurityScanningDetailResp{
		PageInfo: p,
		Items: cvt.Iter(rs, func(_ int, r *db.SecurityScanningResult) *domain.SecurityScanningRiskDetail {
			return cvt.From(r, &domain.SecurityScanningRiskDetail{})
		}),
	}, nil
}

func BySeverityOrder() func(s *sql.Selector) {
	return func(s *sql.Selector) {
		s.OrderExprFunc(func(b *sql.Builder) {
			b.WriteString("case when severity = 'CRITICAL' then 5 when severity = 'ERROR' then 4 when severity = 'WARNING' then 3 when severity = 'INFO' then 2 else 1 end desc")
		})
	}
}
