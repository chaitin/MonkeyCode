package usecase

import (
	"context"
	"fmt"

	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
)

type TeamPolicyUsecase struct {
	repo domain.TeamPolicyRepo
	cfg  *config.Config
}

func NewTeamPolicyUsecase(i *do.Injector) (domain.TeamPolicyUsecase, error) {
	return &TeamPolicyUsecase{
		repo: do.MustInvoke[domain.TeamPolicyRepo](i),
		cfg:  do.MustInvoke[*config.Config](i),
	}, nil
}

func (u *TeamPolicyUsecase) GetTaskVMIdlePolicy(ctx context.Context, teamUser *domain.TeamUser) (*domain.TeamTaskVMIdlePolicy, error) {
	team, err := u.repo.GetTeam(ctx, teamUser.GetTeamID())
	if err != nil {
		return nil, err
	}
	return domain.ResolveTeamTaskVMIdlePolicy(team, u.cfg.VMIdle)
}

func (u *TeamPolicyUsecase) UpdateTaskVMIdlePolicy(ctx context.Context, teamUser *domain.TeamUser, req *domain.UpdateTeamTaskVMIdlePolicyReq) (*domain.TeamTaskVMIdlePolicy, error) {
	if _, err := domain.NewTeamTaskVMIdlePolicyFromReq(teamUser.GetTeamID(), req, u.cfg.VMIdle); err != nil {
		return nil, errcode.ErrInvalidParameter.Wrap(fmt.Errorf("invalid task vm idle policy: %w", err))
	}
	team, err := u.repo.UpdateTaskVMIdlePolicy(ctx, teamUser.GetTeamID(), req)
	if err != nil {
		return nil, err
	}
	return domain.ResolveTeamTaskVMIdlePolicy(team, u.cfg.VMIdle)
}
