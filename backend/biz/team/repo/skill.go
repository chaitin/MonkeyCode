package repo

import (
	"context"
	"log/slog"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/skill"
	"github.com/chaitin/MonkeyCode/backend/db/team"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroup"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroupskill"
	"github.com/chaitin/MonkeyCode/backend/db/teamskill"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type teamSkillRepo struct {
	db     *db.Client
	logger *slog.Logger
}

func NewTeamSkillRepo(i *do.Injector) (domain.TeamSkillRepo, error) {
	return &teamSkillRepo{
		db:     do.MustInvoke[*db.Client](i),
		logger: do.MustInvoke[*slog.Logger](i),
	}, nil
}

func (r *teamSkillRepo) List(ctx context.Context, teamID uuid.UUID) ([]*db.Skill, error) {
	tss, err := r.db.TeamSkill.Query().
		WithSkill(func(sq *db.SkillQuery) {
			sq.WithGroups()
		}).
		Where(teamskill.TeamID(teamID)).
		Order(teamskill.ByCreatedAt(sql.OrderDesc())).
		All(ctx)
	if err != nil {
		return nil, errcode.ErrDatabaseQuery.Wrap(err)
	}
	return cvt.Iter(tss, func(_ int, ts *db.TeamSkill) *db.Skill {
		return ts.Edges.Skill
	}), nil
}

func (r *teamSkillRepo) Create(ctx context.Context, teamID, userID uuid.UUID, req *domain.AddTeamSkillReq) (*db.Skill, error) {
	var skillID uuid.UUID
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		groupIDs, err := resolveTeamSkillGroupIDs(ctx, tx, teamID, req.GroupIDs)
		if err != nil {
			return err
		}

		newSkill, err := tx.Skill.Create().
			SetID(uuid.New()).
			SetUserID(userID).
			SetName(req.Name).
			SetDescription(req.Description).
			SetTags(req.Tags).
			SetContent(req.Content).
			SetPackageObjectKey(req.PackageObjectKey).
			SetPackageURL(req.PackageURL).
			SetSourceType(req.SourceType).
			SetSourceLabel(req.SourceLabel).
			SetSkillMdPath(req.SkillMDPath).
			Save(ctx)
		if err != nil {
			return err
		}
		skillID = newSkill.ID

		if err := tx.TeamSkill.Create().
			SetID(uuid.New()).
			SetTeamID(teamID).
			SetSkillID(newSkill.ID).
			Exec(ctx); err != nil {
			return err
		}

		return replaceTeamSkillGroups(ctx, tx, newSkill.ID, groupIDs)
	})
	if err != nil {
		r.logger.Error("create team skill", "error", err)
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return r.get(ctx, teamID, skillID)
}

func (r *teamSkillRepo) Update(ctx context.Context, teamID uuid.UUID, req *domain.UpdateTeamSkillReq) (*db.Skill, error) {
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		groupIDs, err := resolveTeamSkillGroupIDs(ctx, tx, teamID, req.GroupIDs)
		if err != nil {
			return err
		}

		upt := tx.Skill.UpdateOneID(req.SkillID).Where(skill.HasTeamsWith(team.ID(teamID)))
		if req.Name != "" {
			upt.SetName(req.Name)
		}
		if req.Description != "" {
			upt.SetDescription(req.Description)
		}
		if req.Tags != nil {
			upt.SetTags(req.Tags)
		}
		if req.Content != "" {
			upt.SetContent(req.Content)
		}
		if req.SourceType != "" {
			upt.SetSourceType(req.SourceType)
		}
		if req.SourceLabel != "" {
			upt.SetSourceLabel(req.SourceLabel)
		}
		if req.SkillMDPath != nil {
			upt.SetSkillMdPath(*req.SkillMDPath)
		}
		if err := upt.Exec(ctx); err != nil {
			return err
		}

		if req.GroupIDs != nil {
			return replaceTeamSkillGroups(ctx, tx, req.SkillID, groupIDs)
		}
		return nil
	})
	if err != nil {
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return r.get(ctx, teamID, req.SkillID)
}

func (r *teamSkillRepo) Delete(ctx context.Context, teamID, skillID uuid.UUID) error {
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		if err := tx.Skill.DeleteOneID(skillID).Where(skill.HasTeamsWith(team.ID(teamID))).Exec(ctx); err != nil {
			return err
		}
		if _, err := tx.TeamSkill.Delete().
			Where(teamskill.TeamID(teamID)).
			Where(teamskill.SkillID(skillID)).
			Exec(ctx); err != nil {
			return err
		}
		_, err := tx.TeamGroupSkill.Delete().Where(teamgroupskill.SkillIDEQ(skillID)).Exec(ctx)
		return err
	})
	if err != nil {
		r.logger.Error("delete team skill", "error", err)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return nil
}

func (r *teamSkillRepo) get(ctx context.Context, teamID, skillID uuid.UUID) (*db.Skill, error) {
	ts, err := r.db.TeamSkill.Query().
		WithSkill(func(sq *db.SkillQuery) {
			sq.WithGroups()
		}).
		Where(teamskill.TeamID(teamID)).
		Where(teamskill.SkillID(skillID)).
		First(ctx)
	if err != nil {
		return nil, errcode.ErrDatabaseQuery.Wrap(err)
	}
	return ts.Edges.Skill, nil
}

func resolveTeamSkillGroupIDs(ctx context.Context, tx *db.Tx, teamID uuid.UUID, reqGroupIDs []uuid.UUID) ([]uuid.UUID, error) {
	useDefaultGroup := len(reqGroupIDs) == 0
	groups, err := tx.TeamGroup.Query().
		Where(teamgroup.TeamID(teamID)).
		Where(teamgroup.IDIn(reqGroupIDs...)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	groupIDs := cvt.Iter(groups, func(_ int, group *db.TeamGroup) uuid.UUID {
		return group.ID
	})
	if useDefaultGroup {
		return ensureDefaultGroupIDs(ctx, tx, teamID, groupIDs)
	}
	return groupIDs, nil
}

func replaceTeamSkillGroups(ctx context.Context, tx *db.Tx, skillID uuid.UUID, groupIDs []uuid.UUID) error {
	if _, err := tx.TeamGroupSkill.Delete().Where(teamgroupskill.SkillIDEQ(skillID)).Exec(ctx); err != nil {
		return err
	}

	builders := make([]*db.TeamGroupSkillCreate, 0, len(groupIDs))
	for _, groupID := range groupIDs {
		builders = append(builders, tx.TeamGroupSkill.Create().
			SetID(uuid.New()).
			SetGroupID(groupID).
			SetSkillID(skillID))
	}
	if len(builders) == 0 {
		return nil
	}
	_, err := tx.TeamGroupSkill.CreateBulk(builders...).Save(ctx)
	return err
}
