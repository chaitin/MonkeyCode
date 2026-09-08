package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/database"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool}
}

func (p *Postgres) List(ctx context.Context, ownership string) ([]Model, error) {
	rows, err := sqlc.New(database.Reader(ctx, p.pool)).ListModels(ctx, ownership)
	if err != nil {
		return nil, fmt.Errorf("查询模型: %w", err)
	}
	models, err := readModels(rows)
	if err != nil {
		return nil, err
	}
	if err := p.loadGrants(ctx, models); err != nil {
		return nil, err
	}
	return models, nil
}

func (p *Postgres) Get(ctx context.Context, id string) (Model, error) {
	item, err := readModel(sqlc.New(database.Reader(ctx, p.pool)).GetModel(ctx, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Model{}, ErrNotFound
	}
	if err != nil {
		return Model{}, err
	}
	models := []Model{item}
	if err := p.loadGrants(ctx, models); err != nil {
		return Model{}, err
	}
	return models[0], nil
}

func (p *Postgres) Create(ctx context.Context, item Model) (Model, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return Model{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	advanced, err := json.Marshal(item.AdvancedConfig)
	if err != nil {
		return Model{}, err
	}
	authorization := item.Authorization
	item, err = readModel(sqlc.New(tx).CreateModel(ctx, sqlc.CreateModelParams{
		OwnershipType:    item.OwnershipType,
		OwnerUserID:      item.OwnerUserID,
		ModelID:          item.ModelID,
		DisplayName:      item.DisplayName,
		Protocol:         string(item.Protocol),
		BaseUrl:          item.BaseURL,
		ApiKey:           item.APIKey,
		AdvancedConfig:   advanced,
		CreditMultiplier: float64(item.CreditMultiplier),
	}))
	if err != nil {
		return Model{}, fmt.Errorf("创建模型: %w", err)
	}
	item.Authorization = authorization
	if err := replaceGrants(ctx, tx, item); err != nil {
		return Model{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Model{}, err
	}
	item.Authorization = normalizeAuthorization(item.Authorization)
	return item, nil
}

func (p *Postgres) Update(ctx context.Context, item Model) (Model, error) {
	return p.update(ctx, item, "system")
}

func (p *Postgres) UpdateUser(ctx context.Context, item Model) (Model, error) {
	return p.update(ctx, item, "user")
}

func (p *Postgres) update(ctx context.Context, item Model, ownership string) (Model, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return Model{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	advanced, err := json.Marshal(item.AdvancedConfig)
	if err != nil {
		return Model{}, err
	}
	authorization := item.Authorization
	grantorUserID := item.GrantorUserID
	item, err = readModel(sqlc.New(tx).UpdateModel(ctx, sqlc.UpdateModelParams{
		ID:               item.ID,
		ModelID:          item.ModelID,
		DisplayName:      item.DisplayName,
		Protocol:         string(item.Protocol),
		BaseUrl:          item.BaseURL,
		ApiKey:           item.APIKey,
		AdvancedConfig:   advanced,
		CreditMultiplier: float64(item.CreditMultiplier),
		OwnershipType:    ownership,
		OwnerUserID:      item.OwnerUserID,
	}))
	if errors.Is(err, pgx.ErrNoRows) {
		return Model{}, ErrNotFound
	}
	if err != nil {
		return Model{}, fmt.Errorf("更新模型: %w", err)
	}
	item.Authorization = normalizeAuthorization(authorization)
	item.GrantorUserID = grantorUserID
	if ownership == "system" {
		if err := replaceGrants(ctx, tx, item); err != nil {
			return Model{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Model{}, err
	}
	return item, nil
}

func (p *Postgres) SetEnabled(ctx context.Context, id string, enabled bool) (Model, error) {
	item, err := readModel(sqlc.New(database.Reader(ctx, p.pool)).SetEnabled(ctx, sqlc.SetEnabledParams{ID: id, Enabled: enabled}))
	if errors.Is(err, pgx.ErrNoRows) {
		return Model{}, ErrNotFound
	}
	if err != nil {
		return Model{}, err
	}
	models := []Model{item}
	if err := p.loadGrants(ctx, models); err != nil {
		return Model{}, err
	}
	return models[0], nil
}

func (p *Postgres) Delete(ctx context.Context, id string) error {
	return p.delete(ctx, id, "system", "")
}

func (p *Postgres) DeleteUser(ctx context.Context, id, userID string) error {
	return p.delete(ctx, id, "user", userID)
}

func (p *Postgres) delete(ctx context.Context, id, ownership, userID string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	result, err := sqlc.New(tx).DeleteModel(ctx, sqlc.DeleteModelParams{ID: id, OwnershipType: ownership, OwnerUserID: userID})
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrNotFound
	}
	if _, err := sqlc.New(tx).DeleteGrants(ctx, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (p *Postgres) ListAvailable(ctx context.Context, userID string, isAdmin bool) ([]Model, error) {
	rows, err := sqlc.New(database.Reader(ctx, p.pool)).ListAvailable(ctx, sqlc.ListAvailableParams{OwnerUserID: userID, IsAdmin: isAdmin})
	if err != nil {
		return nil, fmt.Errorf("查询可用模型: %w", err)
	}
	models, err := readModels(rows)
	if err != nil {
		return nil, err
	}
	if err := p.loadPeople(ctx, models, userID); err != nil {
		return nil, err
	}
	return models, nil
}

func (p *Postgres) Resolve(ctx context.Context, userID, requestedModel string) (Model, error) {
	item, err := readModel(sqlc.New(database.Reader(ctx, p.pool)).ResolveModel(ctx, sqlc.ResolveModelParams{UserID: userID, RequestedModel: requestedModel}))
	if errors.Is(err, pgx.ErrNoRows) {
		return Model{}, ErrUnauthorized
	}
	return item, err
}

func (p *Postgres) Subjects(ctx context.Context) (Subjects, error) {
	result := Subjects{Groups: make([]Subject, 0), Users: make([]Subject, 0)}
	groupRows, err := sqlc.New(database.Reader(ctx, p.pool)).ListGroups(ctx)
	if err != nil {
		return Subjects{}, err
	}
	for _, row := range groupRows {
		var subject Subject
		subject.ID, subject.ParentID, subject.Name = row.ID, row.ParentID, row.Name
		result.Groups = append(result.Groups, subject)
	}

	userRows, err := sqlc.New(database.Reader(ctx, p.pool)).ListUsers(ctx)
	if err != nil {
		return Subjects{}, err
	}

	for _, row := range userRows {
		var subject Subject
		subject.ID, subject.Name, subject.Email = row.ID, row.Name, row.Email
		result.Users = append(result.Users, subject)
	}
	return result, nil
}

func readModel(row sqlc.Model, err error) (Model, error) {
	if err != nil {
		return Model{}, err
	}
	item := Model{ID: row.ID, OwnershipType: row.OwnershipType, OwnerUserID: row.OwnerUserID,
		ModelID: row.ModelID, DisplayName: row.DisplayName, Protocol: Protocol(row.Protocol),
		BaseURL: row.BaseUrl, APIKey: row.ApiKey, APIKeyConfigured: row.ApiKey != "",
		CreditMultiplier: row.CreditMultiplier, Enabled: row.Enabled, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
	if err := json.Unmarshal(row.AdvancedConfig, &item.AdvancedConfig); err != nil {
		return Model{}, fmt.Errorf("解析模型高级配置: %w", err)
	}
	return item, nil
}

func readModels(rows []sqlc.Model) ([]Model, error) {
	models := make([]Model, 0, len(rows))
	for _, row := range rows {
		item, err := readModel(row, nil)
		if err != nil {
			return nil, err
		}
		models = append(models, item)
	}
	return models, nil
}

func (p *Postgres) loadGrants(ctx context.Context, models []Model) error {
	if len(models) == 0 {
		return nil
	}
	ids := make([]string, 0, len(models))
	byID := make(map[string]*Model, len(models))
	for index := range models {
		models[index].Authorization = normalizeAuthorization(models[index].Authorization)
		ids = append(ids, models[index].ID)
		byID[models[index].ID] = &models[index]
	}
	rows, err := sqlc.New(database.Reader(ctx, p.pool)).ListGrants(ctx, ids)
	if err != nil {
		return err
	}

	for _, row := range rows {
		var resourceID string
		var userID, groupID *string
		resourceID, userID, groupID = row.ResourceID, row.UserID, row.GroupID
		item := byID[resourceID]
		if userID != nil {
			item.Authorization.UserIDs = append(item.Authorization.UserIDs, *userID)
		}
		if groupID != nil {
			item.Authorization.GroupIDs = append(item.Authorization.GroupIDs, *groupID)
		}
	}
	return nil
}

func replaceGrants(ctx context.Context, tx pgx.Tx, item Model) error {
	grantorUserID := item.GrantorUserID
	if grantorUserID == "" {
		grantorUserID = item.OwnerUserID
	}
	if _, err := sqlc.New(tx).DeleteGrants(ctx, item.ID); err != nil {
		return err
	}
	for _, userID := range item.Authorization.UserIDs {
		if _, err := sqlc.New(tx).GrantUser(ctx, sqlc.GrantUserParams{ResourceID: item.ID, UserID: new(userID), GrantedByUserID: grantorUserID}); err != nil {
			return fmt.Errorf("保存用户授权: %w", err)
		}
	}
	for _, groupID := range item.Authorization.GroupIDs {
		if _, err := sqlc.New(tx).GrantGroup(ctx, sqlc.GrantGroupParams{ResourceID: item.ID, GroupID: new(groupID), GrantedByUserID: grantorUserID}); err != nil {
			return fmt.Errorf("保存分组授权: %w", err)
		}
	}
	return nil
}

func normalizeAuthorization(value Authorization) Authorization {
	value.UserIDs = unique(value.UserIDs)
	value.GroupIDs = unique(value.GroupIDs)
	return value
}

// 与分享、删除使用同一模型行锁，避免删除后仍写入授权。
func (p *Postgres) LockOwned(ctx context.Context, tx pgx.Tx, id, actor string) error {
	_, err := sqlc.New(tx).LockOwned(ctx, sqlc.LockOwnedParams{ID: id, OwnerUserID: actor})

	if errors.Is(err, pgx.ErrNoRows) {
		return resource.NotFound
	}
	return err
}

func (p *Postgres) TouchShared(ctx context.Context, tx pgx.Tx, id string) error {
	_, err := sqlc.New(tx).TouchModel(ctx, id)
	return err
}

func (p *Postgres) loadPeople(ctx context.Context, models []Model, actor string) error {
	ids := make([]string, 0, len(models))
	byID := make(map[string]*Model, len(models))
	for i := range models {
		if models[i].OwnershipType != "user" {
			continue
		}
		ids = append(ids, models[i].ID)
		byID[models[i].ID] = &models[i]
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := sqlc.New(database.Reader(ctx, p.pool)).ListPeople(ctx, sqlc.ListPeopleParams{ModelIds: ids, OwnerUserID: actor})
	if err != nil {
		return err
	}

	for _, row := range rows {
		var id string
		var person Subject
		var creator bool
		id, person.ID, person.Name, person.Email, creator = row.ModelID, row.UserID, row.Name, row.Email, row.Creator
		if creator {
			byID[id].Creator = &person
		} else {
			byID[id].SharedUsers = append(byID[id].SharedUsers, person)
		}
	}
	return nil
}
