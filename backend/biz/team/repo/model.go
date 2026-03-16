package repo

import (
	"context"
	"log/slog"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/model"
	"github.com/chaitin/MonkeyCode/backend/db/team"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroup"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroupmodel"
	"github.com/chaitin/MonkeyCode/backend/db/teammodel"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type teamModelRepo struct {
	db     *db.Client
	logger *slog.Logger
}

func NewTeamModelRepo(i *do.Injector) (domain.TeamModelRepo, error) {
	return &teamModelRepo{
		db:     do.MustInvoke[*db.Client](i),
		logger: do.MustInvoke[*slog.Logger](i),
	}, nil
}

func (r *teamModelRepo) List(ctx context.Context, teamID uuid.UUID) ([]*db.Model, error) {
	tms, err := r.db.TeamModel.Query().
		WithModel(func(mq *db.ModelQuery) {
			mq.WithGroups().WithUser()
		}).
		Where(teammodel.TeamID(teamID)).
		Order(teammodel.ByCreatedAt(sql.OrderDesc())).
		All(ctx)
	if err != nil {
		return nil, errcode.ErrDatabaseQuery.Wrap(err)
	}
	return cvt.Iter(tms, func(_ int, m *db.TeamModel) *db.Model {
		return m.Edges.Model
	}), nil
}

func (r *teamModelRepo) Get(ctx context.Context, teamID, modelID uuid.UUID) (*db.Model, error) {
	tm, err := r.db.TeamModel.Query().
		WithModel().
		Where(teammodel.TeamID(teamID)).
		Where(teammodel.ModelID(modelID)).
		First(ctx)
	if err != nil {
		return nil, errcode.ErrDatabaseQuery.Wrap(err)
	}
	return tm.Edges.Model, nil
}

func (r *teamModelRepo) Create(ctx context.Context, teamID uuid.UUID, userID uuid.UUID, req *domain.AddTeamModelReq) (*db.Model, error) {
	var res *db.Model
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		tgs, err := tx.TeamGroup.Query().
			Where(teamgroup.TeamID(teamID)).
			Where(teamgroup.IDIn(req.GroupIDs...)).
			All(ctx)
		if err != nil {
			return err
		}
		req.GroupIDs = cvt.Iter(tgs, func(_ int, tg *db.TeamGroup) uuid.UUID {
			return tg.ID
		})

		newModel, err := tx.Model.Create().
			SetProvider(req.Provider).
			SetAPIKey(req.APIKey).
			SetBaseURL(req.BaseURL).
			SetModel(req.Model).
			SetUserID(userID).
			SetTemperature(req.Temperature).
			SetInterfaceType(string(req.InterfaceType)).
			Save(ctx)
		if err != nil {
			return err
		}

		if err := tx.TeamModel.Create().
			SetTeamID(teamID).
			SetModelID(newModel.ID).
			Exec(ctx); err != nil {
			return err
		}

		builders := make([]*db.TeamGroupModelCreate, 0)
		for _, gid := range req.GroupIDs {
			builders = append(builders, tx.TeamGroupModel.Create().
				SetGroupID(gid).
				SetModelID(newModel.ID))
		}
		if len(builders) > 0 {
			_, err = tx.TeamGroupModel.CreateBulk(builders...).Save(ctx)
			if err != nil {
				return err
			}
		}

		newModel, err = tx.Model.Query().
			WithGroups().
			Where(model.ID(newModel.ID)).
			First(ctx)
		if err != nil {
			return err
		}
		res = newModel
		return nil
	})
	if err != nil {
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return res, nil
}

func (r *teamModelRepo) Update(ctx context.Context, teamID uuid.UUID, req *domain.UpdateTeamModelReq) (*db.Model, error) {
	var res *db.Model
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		upt := tx.Model.UpdateOneID(req.ModelID).Where(model.HasTeamsWith(team.ID(teamID)))
		if req.Provider != "" {
			upt.SetProvider(req.Provider)
		}
		if req.APIKey != "" {
			upt.SetAPIKey(req.APIKey)
		}
		if req.BaseURL != "" {
			upt.SetBaseURL(req.BaseURL)
		}
		if req.Model != "" {
			upt.SetModel(req.Model)
		}
		if req.Temperature != 0 {
			upt.SetTemperature(req.Temperature)
		}
		if req.InterfaceType != "" {
			upt.SetInterfaceType(string(req.InterfaceType))
		}
		err := upt.Exec(ctx)
		if err != nil {
			return err
		}

		if len(req.GroupIDs) == 0 {
			return nil
		}

		_, err = tx.TeamGroupModel.Delete().Where(teamgroupmodel.ModelID(req.ModelID)).Exec(ctx)
		if err != nil {
			return err
		}
		builders := make([]*db.TeamGroupModelCreate, 0)
		for _, gid := range req.GroupIDs {
			builders = append(builders, tx.TeamGroupModel.Create().
				SetGroupID(gid).
				SetModelID(req.ModelID))
		}
		if len(builders) > 0 {
			_, err = tx.TeamGroupModel.CreateBulk(builders...).Save(ctx)
			if err != nil {
				return err
			}
		}

		newModel, err := tx.Model.Query().
			WithGroups().
			Where(model.ID(req.ModelID)).
			First(ctx)
		if err != nil {
			return err
		}
		res = newModel
		return nil
	})
	if err != nil {
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return res, nil
}

func (r *teamModelRepo) Delete(ctx context.Context, teamID, modelID uuid.UUID) error {
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		err := tx.Model.DeleteOneID(modelID).Where(model.HasTeamsWith(team.ID(teamID))).Exec(ctx)
		if err != nil {
			return err
		}

		if _, err := tx.TeamModel.Delete().
			Where(teammodel.TeamID(teamID)).
			Where(teammodel.ModelID(modelID)).
			Exec(ctx); err != nil {
			return err
		}

		_, err = tx.TeamGroupModel.Delete().Where(teamgroupmodel.ModelID(modelID)).Exec(ctx)
		return err
	})
	if err != nil {
		r.logger.Error("delete model", "error", err)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return nil
}

func (r *teamModelRepo) UpdateCheckResult(ctx context.Context, id uuid.UUID, success bool, errMsg string) error {
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
