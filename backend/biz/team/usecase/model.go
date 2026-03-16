package usecase

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/llm"
)

type teamModelUsecase struct {
	repo   domain.TeamModelRepo
	logger *slog.Logger
}

func NewTeamModelUsecase(i *do.Injector) (domain.TeamModelUsecase, error) {
	return &teamModelUsecase{
		repo:   do.MustInvoke[domain.TeamModelRepo](i),
		logger: do.MustInvoke[*slog.Logger](i),
	}, nil
}

func (u *teamModelUsecase) Add(ctx context.Context, teamUser *domain.TeamUser, req *domain.AddTeamModelReq) (*domain.TeamModel, error) {
	model, err := u.repo.Create(ctx, teamUser.GetTeamID(), teamUser.User.ID, req)
	if err != nil {
		return nil, errcode.ErrDatabaseQuery.Wrap(err)
	}
	m := cvt.From(model, &domain.TeamModel{})
	m.APIKey = model.APIKey
	return m, nil
}

func (u *teamModelUsecase) List(ctx context.Context, teamUser *domain.TeamUser) (*domain.ListTeamModelsResp, error) {
	models, err := u.repo.List(ctx, teamUser.GetTeamID())
	if err != nil {
		return nil, err
	}
	tmodels := cvt.Iter(models, func(_ int, model *db.Model) *domain.TeamModel {
		m := cvt.From(model, &domain.TeamModel{})
		m.APIKey = model.APIKey
		return m
	})
	return &domain.ListTeamModelsResp{Models: tmodels}, nil
}

func (u *teamModelUsecase) Update(ctx context.Context, teamUser *domain.TeamUser, req *domain.UpdateTeamModelReq) (*domain.TeamModel, error) {
	model, err := u.repo.Update(ctx, teamUser.GetTeamID(), req)
	if err != nil {
		return nil, err
	}
	m := cvt.From(model, &domain.TeamModel{})
	m.APIKey = model.APIKey
	return m, nil
}

func (u *teamModelUsecase) Delete(ctx context.Context, teamUser *domain.TeamUser, req *domain.DeleteTeamModelReq) error {
	return u.repo.Delete(ctx, teamUser.GetTeamID(), req.ModelID)
}

func (u *teamModelUsecase) Check(ctx context.Context, teamUser *domain.TeamUser, id uuid.UUID) (*domain.CheckModelResp, error) {
	m, err := u.repo.Get(ctx, teamUser.GetTeamID(), id)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to get team model config", "error", err, "team_id", teamUser.GetTeamID(), "model_id", id)
		return nil, errcode.ErrDatabaseQuery.Wrap(err)
	}

	checkErr := llm.HealthCheck(ctx, llm.Config{
		BaseURL:       m.BaseURL,
		APIKey:        m.APIKey,
		Model:         m.Model,
		InterfaceType: llm.InterfaceType(m.InterfaceType),
	})

	resp := &domain.CheckModelResp{}
	if checkErr != nil {
		u.logger.WarnContext(ctx, "team model health check failed", "model_id", id, "model", m.Model, "error", checkErr)
		resp.Success = false
		resp.Error = checkErr.Error()
		if updateErr := u.repo.UpdateCheckResult(ctx, id, false, checkErr.Error()); updateErr != nil {
			u.logger.ErrorContext(ctx, "failed to update team model check result", "model_id", id, "error", updateErr)
		}
	} else {
		u.logger.InfoContext(ctx, "team model health check succeeded", "model_id", id, "model", m.Model)
		resp.Success = true
		if updateErr := u.repo.UpdateCheckResult(ctx, id, true, ""); updateErr != nil {
			u.logger.ErrorContext(ctx, "failed to update team model check result", "model_id", id, "error", updateErr)
		}
	}

	return resp, nil
}

func (u *teamModelUsecase) CheckByConfig(ctx context.Context, req *domain.CheckByConfigReq) (*domain.CheckModelResp, error) {
	checkErr := llm.HealthCheck(ctx, llm.Config{
		BaseURL:       req.BaseURL,
		APIKey:        req.APIKey,
		Model:         req.Model,
		InterfaceType: llm.InterfaceType(req.InterfaceType),
	})

	resp := &domain.CheckModelResp{}
	if checkErr != nil {
		u.logger.WarnContext(ctx, "team model health check by config failed", "model", req.Model, "error", checkErr)
		resp.Success = false
		resp.Error = checkErr.Error()
	} else {
		u.logger.InfoContext(ctx, "team model health check by config succeeded", "model", req.Model)
		resp.Success = true
	}

	return resp, nil
}
