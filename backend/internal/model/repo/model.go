package repo

import (
	"context"
	"fmt"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/patrickmn/go-cache"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/admin"
	"github.com/chaitin/MonkeyCode/backend/db/model"
	"github.com/chaitin/MonkeyCode/backend/db/task"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/ent/types"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type ModelRepo struct {
	db    *db.Client
	cache *cache.Cache
}

func NewModelRepo(db *db.Client) domain.ModelRepo {
	cache := cache.New(24*time.Hour, 10*time.Minute)
	return &ModelRepo{db: db, cache: cache}
}

func (r *ModelRepo) GetWithCache(ctx context.Context, modelType consts.ModelType) (*db.Model, error) {
	if v, ok := r.cache.Get(string(modelType)); ok {
		return v.(*db.Model), nil
	}

	m, err := r.db.Model.Query().
		Where(model.ModelType(modelType)).
		Where(model.Status(consts.ModelStatusActive)).
		Only(ctx)
	if err != nil {
		return nil, err
	}

	r.cache.Set(string(modelType), m, 24*time.Hour)
	return m, nil
}

func (r *ModelRepo) Create(ctx context.Context, m *domain.CreateModelReq) (*db.Model, error) {
	n, err := r.db.Model.Query().Where(model.ModelType(m.ModelType)).Count(ctx)
	if err != nil {
		return nil, err
	}
	status := consts.ModelStatusInactive
	if n == 0 {
		status = consts.ModelStatusActive
	}

	r.cache.Delete(string(m.ModelType))
	create := r.db.Model.Create().
		SetUserID(m.AdminID).
		SetShowName(m.ShowName).
		SetModelName(m.ModelName).
		SetProvider(m.Provider).
		SetAPIBase(m.APIBase).
		SetAPIKey(m.APIKey).
		SetAPIVersion(m.APIVersion).
		SetAPIHeader(m.APIHeader).
		SetModelType(m.ModelType).
		SetStatus(status)
	if m.Param != nil {
		create.SetParameters(&types.ModelParam{
			R1Enabled:          m.Param.R1Enabled,
			MaxTokens:          m.Param.MaxTokens,
			ContextWindow:      m.Param.ContextWindow,
			SupprtImages:       m.Param.SupprtImages,
			SupportComputerUse: m.Param.SupportComputerUse,
			SupportPromptCache: m.Param.SupportPromptCache,
		})
	} else {
		create.SetParameters(types.DefaultModelParam())
	}
	return create.Save(ctx)
}

func (r *ModelRepo) Update(ctx context.Context, id string, fn func(tx *db.Tx, old *db.Model, up *db.ModelUpdateOne) error) (*db.Model, error) {
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
		r.cache.Delete(string(old.ModelType))
		if old.IsInternal {
			return fmt.Errorf("internal model cannot be updated")
		}

		up := tx.Model.UpdateOneID(old.ID)
		if err := fn(tx, old, up); err != nil {
			return err
		}
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
	q := r.db.Model.Query().
		Where(model.ModelType(req.ModelType)).
		Order(model.ByCreatedAt(sql.OrderAsc()))
	return q.All(ctx)
}

func (r *ModelRepo) ModelUsage(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]domain.ModelUsage, error) {
	var usages []domain.ModelUsage
	err := r.db.Task.Query().
		Where(task.ModelIDIn(ids...)).
		Modify(func(s *sql.Selector) {
			s.Select(
				sql.As(task.FieldModelID, "model_id"),
				sql.As(sql.Sum(task.FieldInputTokens), "input"),
				sql.As(sql.Sum(task.FieldOutputTokens), "output"),
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
	err := r.db.Task.Query().
		Where(
			task.ModelType(modelType),
			task.CreatedAtGTE(time.Now().AddDate(0, 0, -90)),
		).
		Modify(func(s *sql.Selector) {
			s.Select(
				sql.As("date_trunc('day', created_at)", "date"),
				sql.As(sql.Sum(task.FieldInputTokens), "input_tokens"),
				sql.As(sql.Sum(task.FieldOutputTokens), "output_tokens"),
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

func (r *ModelRepo) List(ctx context.Context) (*domain.AllModelResp, error) {
	providers, err := r.db.ModelProvider.Query().WithModels().All(ctx)
	if err != nil {
		return nil, err
	}

	resp := &domain.AllModelResp{
		Providers: cvt.Iter(providers, func(_ int, p *db.ModelProvider) domain.ProviderModel {
			return domain.ProviderModel{
				Provider: p.Name,
				Models: cvt.Iter(p.Edges.Models, func(_ int, m *db.ModelProviderModel) domain.ModelBasic {
					return domain.ModelBasic{
						Name:     m.Name,
						Provider: consts.ModelProvider(p.Name),
						APIBase:  p.APIBase,
					}
				}),
			}
		}),
	}
	return resp, nil
}

func (r *ModelRepo) InitModel(ctx context.Context, modelName, modelKey, modelURL string) error {
	n, err := r.db.Model.Query().
		Where(model.ModelName(modelName)).
		Where(model.Provider(consts.ModelProviderBaiZhiCloud)).
		Where(model.IsInternal(true)).
		Count(ctx)
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}

	a, err := r.db.Admin.Query().Where(admin.Username("admin")).Only(ctx)
	if err != nil {
		return err
	}

	return r.db.Model.Create().
		SetAPIKey(modelKey).
		SetShowName("内置慢速补全模型").
		SetModelName(modelName).
		SetModelType(consts.ModelTypeCoder).
		SetAPIBase(modelURL).
		SetProvider(consts.ModelProviderBaiZhiCloud).
		SetStatus(consts.ModelStatusActive).
		SetUserID(a.ID).
		SetIsInternal(true).
		Exec(ctx)
}

func (r *ModelRepo) Delete(ctx context.Context, id string) error {
	uuidID, err := uuid.Parse(id)
	if err != nil {
		return err
	}
	model, err := r.db.Model.Get(ctx, uuidID)
	if err != nil {
		return err
	}
	if model.IsInternal {
		return fmt.Errorf("internal model can not be deleted")
	}
	if model.Status == consts.ModelStatusActive {
		return fmt.Errorf("active model can not be deleted")
	}
	return r.db.Model.DeleteOneID(uuidID).Exec(ctx)
}
