package usecase

import (
	"context"
	"log/slog"

	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

type teamImageUsecase struct {
	repo   domain.TeamImageRepo
	logger *slog.Logger
}

func NewTeamImageUsecase(i *do.Injector) (domain.TeamImageUsecase, error) {
	return &teamImageUsecase{
		repo:   do.MustInvoke[domain.TeamImageRepo](i),
		logger: do.MustInvoke[*slog.Logger](i),
	}, nil
}

func (u *teamImageUsecase) Add(ctx context.Context, teamUser *domain.TeamUser, req *domain.AddTeamImageReq) (*domain.TeamImage, error) {
	image, err := u.repo.Create(ctx, teamUser.GetTeamID(), teamUser.User.ID, req)
	if err != nil {
		return nil, err
	}
	return cvt.From(image, &domain.TeamImage{}), nil
}

func (u *teamImageUsecase) List(ctx context.Context, teamUser *domain.TeamUser) (*domain.ListTeamImagesResp, error) {
	images, err := u.repo.List(ctx, teamUser)
	if err != nil {
		return nil, err
	}
	return &domain.ListTeamImagesResp{
		Images: cvt.Iter(images, func(_ int, i *db.Image) *domain.TeamImage {
			return cvt.From(i, &domain.TeamImage{})
		}),
	}, nil
}

func (u *teamImageUsecase) Update(ctx context.Context, teamUser *domain.TeamUser, req *domain.UpdateTeamImageReq) (*domain.TeamImage, error) {
	image, err := u.repo.Update(ctx, teamUser.GetTeamID(), req)
	if err != nil {
		return nil, err
	}
	return cvt.From(image, &domain.TeamImage{}), nil
}

func (u *teamImageUsecase) Delete(ctx context.Context, teamUser *domain.TeamUser, req *domain.DeleteTeamImageReq) error {
	return u.repo.Delete(ctx, teamUser.GetTeamID(), req.ImageID)
}
