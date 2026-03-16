package repo

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/image"
	"github.com/chaitin/MonkeyCode/backend/db/predicate"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroup"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type imageRepo struct {
	db *db.Client
}

func NewImageRepo(i *do.Injector) (domain.ImageRepo, error) {
	return &imageRepo{
		db: do.MustInvoke[*db.Client](i),
	}, nil
}

func imageWithUserPredicate(uid uuid.UUID) predicate.Image {
	return image.Or(
		image.UserID(uid),
		image.HasGroupsWith(teamgroup.HasMembersWith(user.ID(uid))),
		image.HasUserWith(user.Role(consts.UserRoleAdmin)),
	)
}

func (r *imageRepo) List(ctx context.Context, uid uuid.UUID, cursor domain.CursorReq) ([]*db.Image, *db.Cursor, error) {
	return r.db.Image.Query().
		Where(imageWithUserPredicate(uid)).
		WithUser(func(q *db.UserQuery) { q.WithTeams() }).
		After(ctx, cursor.Cursor, cursor.Limit)
}

func (r *imageRepo) Create(ctx context.Context, uid uuid.UUID, req *domain.CreateImageReq) (*db.Image, error) {
	var imgID uuid.UUID
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		img, err := tx.Image.Create().
			SetUserID(uid).
			SetName(req.ImageName).
			SetRemark(req.Remark).
			Save(ctx)
		if err != nil {
			return err
		}
		if req.IsDefault {
			u, err := tx.User.Get(ctx, uid)
			if err != nil {
				return err
			}
			defaultConfigs := u.DefaultConfigs
			if defaultConfigs == nil {
				defaultConfigs = make(map[consts.DefaultConfigType]uuid.UUID)
			}
			defaultConfigs[consts.DefaultConfigTypeImage] = img.ID
			err = tx.User.UpdateOneID(uid).
				SetDefaultConfigs(defaultConfigs).
				Exec(ctx)
			if err != nil {
				return err
			}
		}
		imgID = img.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.GetByID(ctx, imgID, uid)
}

func (r *imageRepo) Delete(ctx context.Context, uid, id uuid.UUID) error {
	_, err := r.db.Image.Delete().
		Where(image.UserID(uid)).
		Where(image.ID(id)).
		Exec(ctx)
	return err
}

func (r *imageRepo) Update(ctx context.Context, uid, id uuid.UUID, req *domain.UpdateImageReq) (*db.Image, error) {
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		_, err := tx.Image.Query().
			Where(imageWithUserPredicate(uid)).
			First(ctx)
		if err != nil {
			return errcode.ErrPermision.Wrap(err)
		}

		update := tx.Image.Update().
			Where(image.UserID(uid)).
			Where(image.ID(id))

		if req.ImageName != nil {
			update.SetName(*req.ImageName)
		}
		if req.Remark != nil {
			update.SetRemark(*req.Remark)
		}
		if err := update.Exec(ctx); err != nil {
			return fmt.Errorf("failed to update image: %w", err)
		}

		if req.IsDefault != nil && *req.IsDefault {
			u, err := tx.User.Get(ctx, uid)
			if err != nil {
				return err
			}
			defaultConfigs := u.DefaultConfigs
			if defaultConfigs == nil {
				defaultConfigs = make(map[consts.DefaultConfigType]uuid.UUID)
			}
			defaultConfigs[consts.DefaultConfigTypeImage] = req.ID
			err = tx.User.UpdateOneID(uid).
				SetDefaultConfigs(defaultConfigs).
				Exec(ctx)
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.GetByID(ctx, id, uid)
}

func (r *imageRepo) GetByID(ctx context.Context, id uuid.UUID, uid uuid.UUID) (*db.Image, error) {
	return r.db.Image.Query().
		Where(image.ID(id)).
		Where(imageWithUserPredicate(uid)).
		WithUser(func(q *db.UserQuery) { q.WithTeams() }).
		First(ctx)
}
