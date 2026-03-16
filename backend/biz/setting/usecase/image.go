package usecase

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

type imageUsecase struct {
	userRepo domain.UserRepo
	repo     domain.ImageRepo
	logger   *slog.Logger
}

func NewImageUsecase(i *do.Injector) (domain.ImageUsecase, error) {
	return &imageUsecase{
		repo:     do.MustInvoke[domain.ImageRepo](i),
		userRepo: do.MustInvoke[domain.UserRepo](i),
		logger:   do.MustInvoke[*slog.Logger](i),
	}, nil
}

func (u *imageUsecase) List(ctx context.Context, uid uuid.UUID, cursor domain.CursorReq) (*domain.ListImageResp, error) {
	images, cur, err := u.repo.List(ctx, uid, cursor)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to list user images from repo", "error", err, "user_id", uid)
		return nil, fmt.Errorf("failed to list user images: %w", err)
	}

	user, err := u.userRepo.Get(ctx, uid)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to get user from user repo", "error", err, "user_id", uid)
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return &domain.ListImageResp{
		Images: cvt.Iter(images, func(_ int, i *db.Image) *domain.Image {
			j := cvt.From(i, &domain.Image{})
			j.IsDefault = j.GetIsDefault(user)
			return j
		}),
		Page: cur,
	}, nil
}

func (u *imageUsecase) Create(ctx context.Context, uid uuid.UUID, req *domain.CreateImageReq) (*domain.Image, error) {
	img, err := u.repo.Create(ctx, uid, req)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to create image in repo", "error", err, "user_id", uid)
		return nil, fmt.Errorf("failed to create image: %w", err)
	}
	user, err := u.userRepo.Get(ctx, uid)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to get user from user repo", "error", err, "user_id", uid)
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	j := cvt.From(img, &domain.Image{})
	j.IsDefault = j.GetIsDefault(user)
	return j, nil
}

func (u *imageUsecase) Delete(ctx context.Context, uid, id uuid.UUID) error {
	if err := u.repo.Delete(ctx, uid, id); err != nil {
		u.logger.ErrorContext(ctx, "failed to delete image in repo", "error", err, "user_id", uid, "id", id)
		return fmt.Errorf("failed to delete image: %w", err)
	}
	return nil
}

func (u *imageUsecase) Update(ctx context.Context, uid, id uuid.UUID, req *domain.UpdateImageReq) (*domain.Image, error) {
	img, err := u.repo.Update(ctx, uid, id, req)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to update image in repo", "error", err, "user_id", uid, "id", id)
		return nil, fmt.Errorf("failed to update image: %w", err)
	}
	user, err := u.userRepo.Get(ctx, uid)
	if err != nil {
		u.logger.ErrorContext(ctx, "failed to get user from user repo", "error", err, "user_id", uid)
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	j := cvt.From(img, &domain.Image{})
	j.IsDefault = j.GetIsDefault(user)
	return j, nil
}
