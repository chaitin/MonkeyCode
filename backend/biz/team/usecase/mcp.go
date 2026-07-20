package usecase

import (
	"context"
	"fmt"

	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/netguard"
)

type teamMCPUsecase struct {
	repo       domain.TeamMCPRepo
	syncClient domain.UserMCPSyncClient
	guard      *netguard.Guard
}

func NewTeamMCPUsecase(i *do.Injector) (domain.TeamMCPUsecase, error) {
	cfg := do.MustInvoke[*config.Config](i)
	return &teamMCPUsecase{
		repo:       do.MustInvoke[domain.TeamMCPRepo](i),
		syncClient: do.MustInvoke[domain.UserMCPSyncClient](i),
		guard:      netguard.New(cfg.Security.BlockPrivateNetwork),
	}, nil
}

func (u *teamMCPUsecase) ListUpstreams(ctx context.Context, teamUser *domain.TeamUser) (*domain.ListTeamMCPUpstreamsResp, error) {
	rows, err := u.repo.ListUpstreams(ctx, teamUser.GetTeamID())
	if err != nil {
		return nil, err
	}
	return &domain.ListTeamMCPUpstreamsResp{
		Items: cvt.Iter(rows, func(_ int, row *db.MCPUpstream) *domain.TeamMCPUpstream {
			return cvt.From(row, &domain.TeamMCPUpstream{})
		}),
	}, nil
}

func (u *teamMCPUsecase) CreateUpstream(ctx context.Context, teamUser *domain.TeamUser, req domain.CreateTeamMCPUpstreamReq) (*domain.TeamMCPUpstream, error) {
	if err := u.guard.ValidateURL(ctx, req.URL); err != nil {
		return nil, errcode.ErrInvalidParameter.Wrap(err)
	}
	if ok, err := u.repo.HasPlatformSlug(ctx, req.Slug); err != nil {
		return nil, err
	} else if ok {
		return nil, fmt.Errorf("mcp upstream slug conflicts with platform upstream")
	}
	row, err := u.repo.CreateUpstream(ctx, teamUser.GetTeamID(), &req)
	if err != nil {
		return nil, err
	}
	return cvt.From(row, &domain.TeamMCPUpstream{}), nil
}

func (u *teamMCPUsecase) UpdateUpstream(ctx context.Context, teamUser *domain.TeamUser, req domain.UpdateTeamMCPUpstreamReq) (*domain.TeamMCPUpstream, error) {
	if req.URL != nil {
		if err := u.guard.ValidateURL(ctx, *req.URL); err != nil {
			return nil, errcode.ErrInvalidParameter.Wrap(err)
		}
	}
	if req.Slug != nil {
		if ok, err := u.repo.HasPlatformSlug(ctx, *req.Slug); err != nil {
			return nil, err
		} else if ok {
			return nil, fmt.Errorf("mcp upstream slug conflicts with platform upstream")
		}
	}
	row, err := u.repo.UpdateUpstream(ctx, teamUser.GetTeamID(), &req)
	if err != nil {
		return nil, err
	}
	return cvt.From(row, &domain.TeamMCPUpstream{}), nil
}

func (u *teamMCPUsecase) DeleteUpstream(ctx context.Context, teamUser *domain.TeamUser, req domain.DeleteTeamMCPUpstreamReq) error {
	return u.repo.DeleteUpstream(ctx, teamUser.GetTeamID(), req.UpstreamID)
}

func (u *teamMCPUsecase) SyncUpstream(ctx context.Context, teamUser *domain.TeamUser, req domain.SyncTeamMCPUpstreamReq) error {
	if _, err := u.repo.GetUpstream(ctx, teamUser.GetTeamID(), req.UpstreamID); err != nil {
		return err
	}
	return u.syncClient.SyncUpstream(ctx, req.UpstreamID)
}
