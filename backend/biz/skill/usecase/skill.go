// Package usecase implements the user-facing skill picker. Skills themselves
// are owned by team management (see backend/biz/team); this package only
// adapts the team repo for read-only access scoped to the requesting user's
// active team and rewrites PackageURL with a short-lived presigned GET URL.
package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/team/usecase"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

const presignedSkillURLTTL = time.Hour

type userSkillUsecase struct {
	repo         domain.TeamSkillRepo
	packageStore usecase.SkillPackageStore
	logger       *slog.Logger
}

func NewUserSkillUsecase(i *do.Injector) (domain.UserSkillUsecase, error) {
	store, err := do.Invoke[usecase.SkillPackageStore](i)
	if err != nil {
		store = nil
	}
	return &userSkillUsecase{
		repo:         do.MustInvoke[domain.TeamSkillRepo](i),
		packageStore: store,
		logger:       do.MustInvoke[*slog.Logger](i).With("usecase", "user_skill"),
	}, nil
}

func (u *userSkillUsecase) List(ctx context.Context, user *domain.User) (*domain.ListTeamSkillsResp, error) {
	if user == nil || user.Team == nil {
		return nil, errcode.ErrUnauthorized.Wrap(fmt.Errorf("user has no active team"))
	}

	skills, err := u.repo.List(ctx, user.Team.ID)
	if err != nil {
		return nil, err
	}

	out := cvt.Iter(skills, func(_ int, s *db.Skill) *domain.TeamSkill {
		dto := cvt.From(s, &domain.TeamSkill{})
		if u.packageStore != nil && dto.PackageKey != "" {
			url, err := u.packageStore.PresignGet(ctx, dto.PackageKey, presignedSkillURLTTL)
			if err != nil {
				u.logger.WarnContext(ctx, "presign skill package failed",
					"skill_id", dto.ID, "object_key", dto.PackageKey, "error", err)
				dto.PackageURL = ""
			} else {
				dto.PackageURL = url
			}
		} else {
			dto.PackageURL = ""
		}
		return dto
	})

	return &domain.ListTeamSkillsResp{Skills: out}, nil
}

func (u *userSkillUsecase) Refs(ctx context.Context, user *domain.User, skillIDs []uuid.UUID) ([]domain.SkillRef, error) {
	if len(skillIDs) == 0 {
		return nil, nil
	}
	if user == nil || user.Team == nil {
		return nil, errcode.ErrUnauthorized.Wrap(fmt.Errorf("user has no active team"))
	}
	if u.packageStore == nil {
		return nil, nil
	}

	skills, err := u.repo.List(ctx, user.Team.ID)
	if err != nil {
		return nil, err
	}
	byID := make(map[uuid.UUID]*db.Skill, len(skills))
	for _, s := range skills {
		byID[s.ID] = s
	}

	out := make([]domain.SkillRef, 0, len(skillIDs))
	for _, id := range skillIDs {
		s, ok := byID[id]
		if !ok || s.PackageObjectKey == "" {
			continue
		}
		url, err := u.packageStore.PresignGet(ctx, s.PackageObjectKey, presignedSkillURLTTL)
		if err != nil {
			u.logger.WarnContext(ctx, "presign skill package for dispatch failed",
				"skill_id", s.ID, "object_key", s.PackageObjectKey, "error", err)
			continue
		}
		out = append(out, domain.SkillRef{
			Name:          s.Name,
			ZipURL:        url,
			EntryFilename: s.SkillMdPath,
		})
	}
	return out, nil
}
