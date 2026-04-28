package repo

import (
	"context"
	"fmt"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/model"
	"github.com/chaitin/MonkeyCode/backend/db/modelapikey"
	"github.com/chaitin/MonkeyCode/backend/db/predicate"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroup"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type modelRepo struct {
	db *db.Client
}

func NewModelRepo(i *do.Injector) (domain.ModelRepo, error) {
	return &modelRepo{
		db: do.MustInvoke[*db.Client](i),
	}, nil
}

func modelWithUserPredicate(uid uuid.UUID) predicate.Model {
	return model.Or(
		model.UserID(uid),
		model.HasGroupsWith(teamgroup.HasMembersWith(user.ID(uid))),
		model.HasUserWith(user.Role(consts.UserRoleAdmin)),
	)
}

func modelListWithUserPredicate(uid uuid.UUID) predicate.Model {
	return model.Or(
		model.UserID(uid),
		model.HasGroupsWith(teamgroup.HasMembersWith(user.ID(uid))),
	)
}

func (r *modelRepo) Get(ctx context.Context, uid, id uuid.UUID) (*db.Model, error) {
	return r.db.Model.Query().
		Where(modelWithUserPredicate(uid)).
		Where(model.ID(id)).
		WithUser(func(q *db.UserQuery) { q.WithTeams() }).
		First(ctx)
}

func (r *modelRepo) CreateRuntimeAPIKey(ctx context.Context, uid, modelID uuid.UUID, vmID string) (string, error) {
	var runtimeKey string
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		_, err := tx.Model.Query().
			Where(modelWithUserPredicate(uid)).
			Where(model.ID(modelID)).
			First(ctx)
		if err != nil {
			return err
		}

		if vmID != "" {
			key, err := tx.ModelApiKey.Query().
				Where(modelapikey.UserID(uid), modelapikey.VirtualmachineID(vmID)).
				Order(modelapikey.ByCreatedAt(sql.OrderDesc()), modelapikey.ByID(sql.OrderDesc())).
				First(ctx)
			if err != nil && !db.IsNotFound(err) {
				return err
			}
			if err == nil {
				if key.ModelID != modelID {
					if err := tx.ModelApiKey.UpdateOneID(key.ID).
						SetModelID(modelID).
						Exec(ctx); err != nil {
						return err
					}
				}
				runtimeKey = key.APIKey
				return nil
			}
		}

		apiKey := uuid.NewString()
		create := tx.ModelApiKey.Create().
			SetID(uuid.New()).
			SetUserID(uid).
			SetModelID(modelID).
			SetAPIKey(apiKey)
		if vmID != "" {
			create.SetVirtualmachineID(vmID)
		}
		if _, err := create.Save(ctx); err != nil {
			return err
		}
		runtimeKey = apiKey
		return nil
	})
	if err != nil {
		return "", err
	}
	return runtimeKey, nil
}

func (r *modelRepo) List(ctx context.Context, uid uuid.UUID, cursor domain.CursorReq) ([]*db.Model, *db.Cursor, error) {
	var (
		models []*db.Model
		page   *db.Cursor
	)
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		ms, p, err := tx.Model.Query().
			Where(modelListWithUserPredicate(uid)).
			WithUser(func(q *db.UserQuery) { q.WithTeams() }).
			After(ctx, cursor.Cursor, cursor.Limit)
		if err != nil {
			return err
		}
		models, page = ms, p
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return models, page, nil
}

func (r *modelRepo) Create(ctx context.Context, uid uuid.UUID, req *domain.CreateModelReq) (*db.Model, error) {
	var modelID uuid.UUID
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		m, err := tx.Model.Create().
			SetUserID(uid).
			SetProvider(req.Provider).
			SetAPIKey(req.APIKey).
			SetBaseURL(req.BaseURL).
			SetModel(req.Model).
			SetLastCheckAt(time.Now()).
			SetLastCheckSuccess(true).
			SetTemperature(float64(req.Temperature)).
			SetInterfaceType(string(req.InterfaceType)).
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
			defaultConfigs[consts.DefaultConfigTypeModel] = m.ID
			err = tx.User.UpdateOneID(uid).
				SetDefaultConfigs(defaultConfigs).
				Exec(ctx)
			if err != nil {
				return err
			}
		}
		modelID = m.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.Get(ctx, uid, modelID)
}

func (r *modelRepo) Delete(ctx context.Context, uid, id uuid.UUID) error {
	_, err := r.db.Model.Delete().
		Where(model.UserID(uid)).
		Where(model.ID(id)).
		Exec(ctx)
	return err
}

func (r *modelRepo) Update(ctx context.Context, uid, id uuid.UUID, req *domain.UpdateModelReq) error {
	return entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		_, err := tx.Model.Query().
			Where(modelWithUserPredicate(uid)).
			Where(model.ID(id)).
			First(ctx)
		if err != nil {
			return errcode.ErrPermision.Wrap(err)
		}

		update := tx.Model.Update().
			Where(model.UserID(uid)).
			Where(model.ID(id))

		if req.Provider != nil {
			update.SetProvider(*req.Provider)
		}
		if req.APIKey != nil {
			update.SetAPIKey(*req.APIKey)
		}
		if req.BaseURL != nil {
			update.SetBaseURL(*req.BaseURL)
		}
		if req.Model != nil {
			update.SetModel(*req.Model)
		}
		if req.Temperature != nil {
			update.SetTemperature(float64(*req.Temperature))
		}
		if req.InterfaceType != nil {
			update.SetInterfaceType(string(*req.InterfaceType))
		}
		if err := update.Exec(ctx); err != nil {
			return fmt.Errorf("failed to update model config: %w", err)
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
			defaultConfigs[consts.DefaultConfigTypeModel] = req.ID
			err = tx.User.UpdateOneID(uid).
				SetDefaultConfigs(defaultConfigs).
				Exec(ctx)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *modelRepo) UpdateCheckResult(ctx context.Context, id uuid.UUID, success bool, errMsg string) error {
	updateQuery := r.db.Model.UpdateOneID(id).
		SetLastCheckAt(time.Now()).
		SetLastCheckSuccess(success)

	if success {
		updateQuery = updateQuery.ClearLastCheckError()
	} else {
		updateQuery = updateQuery.SetLastCheckError(errMsg)
	}

	return updateQuery.Exec(ctx)
}
