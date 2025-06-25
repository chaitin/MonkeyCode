package repo

import (
	"context"
	"time"

	entsql "entgo.io/ent/dialect/sql"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/model"
	"github.com/chaitin/MonkeyCode/backend/db/record"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type ModelRepo struct {
	db *db.Client
}

func NewModelRepo(db *db.Client) domain.ModelRepo {
	return &ModelRepo{db: db}
}

func (r *ModelRepo) Create(ctx context.Context, m *domain.CreateModelReq) (*db.Model, error) {
	uid, err := uuid.Parse(m.UserID)
	if err != nil {
		return nil, err
	}
	return r.db.Model.Create().
		SetUserID(uid).
		SetModelName(m.ModelName).
		SetProvider(m.Provider).
		SetAPIBase(m.APIBase).
		SetAPIKey(m.APIKey).
		SetModelType(m.ModelType).
		SetStatus(consts.ModelStatusActive).
		Save(ctx)
}

func (r *ModelRepo) Update(ctx context.Context, id string, fn func(up *db.ModelUpdateOne)) (*db.Model, error) {
	modelID, err := uuid.Parse(id)
	if err != nil {
		return nil, err
	}
	var m *db.Model
	err = entx.WithTx(ctx, r.db, func(tx *db.Tx) error {
		old, err := tx.Model.Get(ctx, modelID)
		if err != nil {
			return err
		}

		up := tx.Model.UpdateOneID(old.ID)
		fn(up)
		if n, err := up.Save(ctx); err != nil {
			return err
		} else {
			m = n
		}
		return nil
	})
	return m, err
}

func (r *ModelRepo) MyModelList(ctx context.Context, req *domain.MyModelListReq) ([]*db.Model, error) {
	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		return nil, err
	}
	q := r.db.Model.Query().Where(model.UserID(userID)).Where(model.ModelType(req.ModelType))
	return q.All(ctx)
}

func (r *ModelRepo) ModelUsage(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]domain.ModelUsage, error) {
	var usages []domain.ModelUsage
	err := r.db.Record.Query().
		Where(record.ModelIDIn(ids...)).
		Modify(func(s *entsql.Selector) {
			s.Select(
				entsql.As(record.FieldModelID, "model_id"),
				entsql.As(entsql.Sum(record.FieldInputTokens), "input"),
				entsql.As(entsql.Sum(record.FieldOutputTokens), "output"),
			).
				GroupBy("model_id").
				OrderBy("model_id")
		}).
		Scan(ctx, &usages)
	if err != nil {
		return nil, err
	}

	return cvt.IterToMap(usages, func(_ int, u domain.ModelUsage) (uuid.UUID, domain.ModelUsage) {
		return u.ModelID, u
	}), nil
}

type TokenUsage struct {
	Input  int64 `json:"input"`  // 输入token数
	Output int64 `json:"output"` // 输出token数
}

type DailyUsage struct {
	Date         time.Time `json:"date"`          // 时间戳
	InputTokens  int64     `json:"input_tokens"`  // 输入token数
	OutputTokens int64     `json:"output_tokens"` // 输出token数
}

func (r *ModelRepo) GetTokenUsage(ctx context.Context, modelType consts.ModelType) (*domain.ModelTokenUsageResp, error) {
	var dailyUsages []DailyUsage
	err := r.db.Record.Query().
		Where(
			record.ModelType(modelType),
			record.CreatedAtGTE(time.Now().AddDate(0, 0, -90)),
		).
		Modify(func(s *entsql.Selector) {
			s.Select(
				entsql.As("date_trunc('day', created_at)", "date"),
				entsql.As(entsql.Sum(record.FieldInputTokens), "input_tokens"),
				entsql.As(entsql.Sum(record.FieldOutputTokens), "output_tokens"),
			).
				GroupBy("date").
				OrderBy("date")
		}).
		Scan(ctx, &dailyUsages)

	if err != nil {
		return nil, err
	}

	resp := &domain.ModelTokenUsageResp{
		InputUsage:  []domain.ModelTokenUsage{},
		OutputUsage: []domain.ModelTokenUsage{},
	}

	for _, usage := range dailyUsages {
		resp.TotalInput += usage.InputTokens
		resp.TotalOutput += usage.OutputTokens
		resp.InputUsage = append(resp.InputUsage, domain.ModelTokenUsage{
			Timestamp: usage.Date.Unix(),
			Tokens:    usage.InputTokens,
		})
		resp.OutputUsage = append(resp.OutputUsage, domain.ModelTokenUsage{
			Timestamp: usage.Date.Unix(),
			Tokens:    usage.OutputTokens,
		})
	}

	return resp, nil
}
