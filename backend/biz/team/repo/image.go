package repo

import (
	"context"
	"log/slog"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/image"
	"github.com/chaitin/MonkeyCode/backend/db/team"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroup"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroupimage"
	"github.com/chaitin/MonkeyCode/backend/db/teamimage"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type teamImageRepo struct {
	db     *db.Client
	logger *slog.Logger
}

func NewTeamImageRepo(i *do.Injector) (domain.TeamImageRepo, error) {
	return &teamImageRepo{
		db:     do.MustInvoke[*db.Client](i),
		logger: do.MustInvoke[*slog.Logger](i),
	}, nil
}

func (r *teamImageRepo) List(ctx context.Context, teamUser *domain.TeamUser) ([]*db.Image, error) {
	tis, err := r.db.TeamImage.Query().
		WithImage(func(iq *db.ImageQuery) {
			iq.WithGroups()
		}).
		Where(teamimage.TeamID(teamUser.GetTeamID())).
		Order(teamimage.ByCreatedAt(sql.OrderDesc())).
		All(ctx)
	if err != nil {
		return nil, errcode.ErrDatabaseQuery.Wrap(err)
	}

	return cvt.Iter(tis, func(_ int, ti *db.TeamImage) *db.Image {
		return ti.Edges.Image
	}), nil
}

func (r *teamImageRepo) Get(ctx context.Context, teamID, imageID uuid.UUID) (*db.Image, error) {
	ti, err := r.db.TeamImage.Query().
		WithImage(func(iq *db.ImageQuery) {
			iq.WithGroups().WithUser()
		}).
		Where(teamimage.TeamID(teamID)).
		Where(teamimage.ImageID(imageID)).
		First(ctx)
	if err != nil {
		r.logger.Error("query image", "error", err)
		return nil, errcode.ErrDatabaseQuery.Wrap(err)
	}

	return ti.Edges.Image, nil
}

func (r *teamImageRepo) Create(ctx context.Context, teamID, userID uuid.UUID, req *domain.AddTeamImageReq) (*db.Image, error) {
	var imgID uuid.UUID
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		tgs, err := tx.TeamGroup.Query().
			Where(teamgroup.IDIn(req.GroupIDs...)).
			All(ctx)
		if err != nil {
			return err
		}

		req.GroupIDs = cvt.Iter(tgs, func(_ int, tg *db.TeamGroup) uuid.UUID { return tg.ID })

		img, err := tx.Image.Create().
			SetUserID(userID).
			SetName(req.Name).
			SetRemark(req.Remark).
			Save(ctx)
		if err != nil {
			return err
		}
		imgID = img.ID

		if err := tx.TeamImage.Create().
			SetImageID(img.ID).
			SetTeamID(teamID).
			Exec(ctx); err != nil {
			return err
		}

		builders := make([]*db.TeamGroupImageCreate, 0)
		for _, gid := range req.GroupIDs {
			builders = append(builders, tx.TeamGroupImage.Create().
				SetGroupID(gid).
				SetImageID(img.ID))
		}
		if len(builders) > 0 {
			_, err = tx.TeamGroupImage.CreateBulk(builders...).Save(ctx)
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		r.logger.Error("create team image with group", "error", err)
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return r.Get(ctx, teamID, imgID)
}

func (r *teamImageRepo) Update(ctx context.Context, teamID uuid.UUID, req *domain.UpdateTeamImageReq) (*db.Image, error) {
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		tgs, err := tx.TeamGroup.Query().
			Where(teamgroup.IDIn(req.GroupIDs...)).
			All(ctx)
		if err != nil {
			return err
		}

		req.GroupIDs = cvt.Iter(tgs, func(_ int, tg *db.TeamGroup) uuid.UUID { return tg.ID })
		upt := r.db.Image.UpdateOneID(req.ImageID).Where(image.HasTeamsWith(team.ID(teamID)))
		if req.Name != "" {
			upt.SetName(req.Name)
		}
		if req.Remark != "" {
			upt.SetRemark(req.Remark)
		}
		err = upt.Exec(ctx)
		if err != nil {
			return err
		}

		if len(req.GroupIDs) == 0 {
			return nil
		}

		_, err = tx.TeamGroupImage.Delete().Where(teamgroupimage.ImageIDEQ(req.ImageID)).Exec(ctx)
		if err != nil {
			return err
		}
		builders := make([]*db.TeamGroupImageCreate, 0)
		for _, gid := range req.GroupIDs {
			builders = append(builders, tx.TeamGroupImage.Create().
				SetGroupID(gid).
				SetImageID(req.ImageID))
		}
		if len(builders) > 0 {
			_, err = tx.TeamGroupImage.CreateBulk(builders...).Save(ctx)
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return r.Get(ctx, teamID, req.ImageID)
}

func (r *teamImageRepo) Delete(ctx context.Context, teamID, imageID uuid.UUID) error {
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		err := tx.Image.DeleteOneID(imageID).Where(image.HasTeamsWith(team.ID(teamID))).Exec(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.TeamImage.Delete().
			Where(teamimage.TeamID(teamID)).
			Where(teamimage.ImageID(imageID)).
			Exec(ctx); err != nil {
			return errcode.ErrDatabaseOperation.Wrap(err)
		}
		_, err = tx.TeamGroupImage.Delete().Where(teamgroupimage.ImageIDEQ(imageID)).Exec(ctx)
		return err
	})
	if err != nil {
		r.logger.Error("delete image", "error", err)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return nil
}
