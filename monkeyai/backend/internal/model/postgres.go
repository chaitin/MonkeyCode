package model

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/database"

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
	rows, err := database.Reader(ctx, p.pool).Query(ctx, modelSelect+`
		WHERE deleted_at IS NULL AND ($1 = '' OR ownership_type = $1)
		ORDER BY created_at DESC
	`, ownership)
	if err != nil {
		return nil, fmt.Errorf("查询模型: %w", err)
	}
	models, err := scanModels(rows)
	if err != nil {
		return nil, err
	}
	if err := p.loadGrants(ctx, models); err != nil {
		return nil, err
	}
	return models, nil
}

func (p *Postgres) Get(ctx context.Context, id string) (Model, error) {
	item, err := scanModel(database.Reader(ctx, p.pool).QueryRow(ctx, modelSelect+`
		WHERE id = $1 AND deleted_at IS NULL
	`, id))
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
	item, err = scanModel(tx.QueryRow(ctx, `
		INSERT INTO models (
			ownership_type, owner_user_id, model_id, display_name, protocol,
			base_url, api_key, advanced_config, credit_multiplier, enabled
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
		RETURNING id, ownership_type, owner_user_id, model_id, display_name,
			protocol, base_url, api_key, advanced_config, credit_multiplier,
			enabled, created_at, updated_at
	`, item.OwnershipType, item.OwnerUserID, item.ModelID, item.DisplayName,
		item.Protocol, item.BaseURL, item.APIKey, advanced, item.CreditMultiplier))
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
	item, err = scanModel(tx.QueryRow(ctx, `
		UPDATE models SET
			model_id = $2, display_name = $3, protocol = $4, base_url = $5,
			api_key = $6, advanced_config = $7, credit_multiplier = $8,
			updated_at = now()
		WHERE id = $1 AND ownership_type = 'system' AND deleted_at IS NULL
		RETURNING id, ownership_type, owner_user_id, model_id, display_name,
			protocol, base_url, api_key, advanced_config, credit_multiplier,
			enabled, created_at, updated_at
	`, item.ID, item.ModelID, item.DisplayName, item.Protocol, item.BaseURL,
		item.APIKey, advanced, item.CreditMultiplier))
	if errors.Is(err, pgx.ErrNoRows) {
		return Model{}, ErrNotFound
	}
	if err != nil {
		return Model{}, fmt.Errorf("更新模型: %w", err)
	}
	item.Authorization = normalizeAuthorization(authorization)
	item.GrantorUserID = grantorUserID
	if err := replaceGrants(ctx, tx, item); err != nil {
		return Model{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Model{}, err
	}
	return item, nil
}

func (p *Postgres) SetEnabled(ctx context.Context, id string, enabled bool) (Model, error) {
	item, err := scanModel(database.Reader(ctx, p.pool).QueryRow(ctx, `
		UPDATE models SET enabled = $2, updated_at = now()
		WHERE id = $1 AND ownership_type = 'system' AND deleted_at IS NULL
		RETURNING id, ownership_type, owner_user_id, model_id, display_name,
			protocol, base_url, api_key, advanced_config, credit_multiplier,
			enabled, created_at, updated_at
	`, id, enabled))
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
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	result, err := tx.Exec(ctx, `
		UPDATE models SET deleted_at = now(), enabled = false, updated_at = now()
		WHERE id = $1 AND ownership_type = 'system' AND deleted_at IS NULL
	`, id)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return ErrNotFound
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM resource_access_grants
		WHERE resource_type = 'model' AND resource_id = $1
	`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (p *Postgres) ListAvailable(ctx context.Context, userID string, isAdmin bool) ([]Model, error) {
	rows, err := database.Reader(ctx, p.pool).Query(ctx, availableModelSelect+`
		ORDER BY m.display_name, m.id
	`, userID, isAdmin)
	if err != nil {
		return nil, fmt.Errorf("查询可用模型: %w", err)
	}
	return scanModels(rows)
}

func (p *Postgres) Resolve(ctx context.Context, userID, id string) (Model, error) {
	item, err := scanModel(database.Reader(ctx, p.pool).QueryRow(ctx, `
		WITH RECURSIVE user_groups(group_id) AS (
			SELECT id FROM groups WHERE deleted_at IS NULL AND (parent_id IS NULL OR (id='00000000-0000-0000-0000-000000000002' AND EXISTS(SELECT 1 FROM users WHERE id=$1 AND role='admin')) OR id IN(SELECT group_id FROM group_users WHERE user_id=$1 AND removed_at IS NULL))
			UNION
			SELECT parent.id
			FROM groups g
			JOIN user_groups ug ON ug.group_id = g.id
            JOIN groups parent ON parent.id=g.parent_id
			WHERE parent.deleted_at IS NULL AND g.deleted_at IS NULL
		)
		SELECT m.id, m.ownership_type, m.owner_user_id, m.model_id,
			m.display_name, m.protocol, m.base_url, m.api_key,
			m.advanced_config, m.credit_multiplier, m.enabled,
			m.created_at, m.updated_at
		FROM models m
		JOIN users u ON u.id = $1
		WHERE m.id = $2 AND m.enabled AND m.deleted_at IS NULL
			AND (
				u.role = 'admin'
				OR m.owner_user_id = $1
				OR EXISTS (
					SELECT 1 FROM resource_access_grants rag
					WHERE rag.resource_type = 'model' AND rag.resource_id = m.id
						AND (rag.user_id = $1 OR rag.group_id IN (SELECT group_id FROM user_groups))
				)
			)
	`, userID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Model{}, ErrUnauthorized
	}
	return item, err
}

func (p *Postgres) Subjects(ctx context.Context) (Subjects, error) {
	result := Subjects{Groups: make([]Subject, 0), Users: make([]Subject, 0)}
	groupRows, err := database.Reader(ctx, p.pool).Query(ctx, `
		SELECT id, parent_id, name FROM groups
		WHERE deleted_at IS NULL ORDER BY name, id
	`)
	if err != nil {
		return Subjects{}, err
	}
	for groupRows.Next() {
		var subject Subject
		if err := groupRows.Scan(&subject.ID, &subject.ParentID, &subject.Name); err != nil {
			groupRows.Close()
			return Subjects{}, err
		}
		result.Groups = append(result.Groups, subject)
	}
	if err := groupRows.Err(); err != nil {
		groupRows.Close()
		return Subjects{}, err
	}
	groupRows.Close()

	userRows, err := database.Reader(ctx, p.pool).Query(ctx, `
		SELECT id, name, email FROM users
		WHERE status = 'active' AND deleted_at IS NULL ORDER BY name, id
	`)
	if err != nil {
		return Subjects{}, err
	}
	defer userRows.Close()
	for userRows.Next() {
		var subject Subject
		if err := userRows.Scan(&subject.ID, &subject.Name, &subject.Email); err != nil {
			return Subjects{}, err
		}
		result.Users = append(result.Users, subject)
	}
	return result, userRows.Err()
}

const modelSelect = `
	SELECT id, ownership_type, owner_user_id, model_id, display_name,
		protocol, base_url, api_key, advanced_config, credit_multiplier,
		enabled, created_at, updated_at
	FROM models
`

const availableModelSelect = `
	WITH RECURSIVE user_groups(group_id) AS (
		SELECT id FROM groups WHERE deleted_at IS NULL AND (parent_id IS NULL OR (id='00000000-0000-0000-0000-000000000002' AND EXISTS(SELECT 1 FROM users WHERE id=$1 AND role='admin')) OR id IN(SELECT group_id FROM group_users WHERE user_id=$1 AND removed_at IS NULL))
		UNION
		SELECT parent.id
		FROM groups g
		JOIN user_groups ug ON ug.group_id = g.id
            JOIN groups parent ON parent.id=g.parent_id
		WHERE parent.deleted_at IS NULL AND g.deleted_at IS NULL
	)
	SELECT m.id, m.ownership_type, m.owner_user_id, m.model_id,
		m.display_name, m.protocol, m.base_url, m.api_key,
		m.advanced_config, m.credit_multiplier, m.enabled,
		m.created_at, m.updated_at
	FROM models m
	WHERE m.enabled AND m.deleted_at IS NULL
		AND (
			$2
			OR m.owner_user_id = $1
			OR EXISTS (
				SELECT 1 FROM resource_access_grants rag
				WHERE rag.resource_type = 'model' AND rag.resource_id = m.id
					AND (rag.user_id = $1 OR rag.group_id IN (SELECT group_id FROM user_groups))
			)
		)
`

type scanner interface {
	Scan(...any) error
}

func scanModel(row scanner) (Model, error) {
	var item Model
	var advanced []byte
	err := row.Scan(
		&item.ID, &item.OwnershipType, &item.OwnerUserID, &item.ModelID,
		&item.DisplayName, &item.Protocol, &item.BaseURL, &item.APIKey, &advanced,
		&item.CreditMultiplier, &item.Enabled, &item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return Model{}, err
	}
	if err := json.Unmarshal(advanced, &item.AdvancedConfig); err != nil {
		return Model{}, fmt.Errorf("解析模型高级配置: %w", err)
	}
	item.APIKeyConfigured = item.APIKey != ""
	return item, nil
}

func scanModels(rows pgx.Rows) ([]Model, error) {
	defer rows.Close()
	models := make([]Model, 0)
	for rows.Next() {
		item, err := scanModel(rows)
		if err != nil {
			return nil, err
		}
		models = append(models, item)
	}
	return models, rows.Err()
}

func (p *Postgres) loadGrants(ctx context.Context, models []Model) error {
	if len(models) == 0 {
		return nil
	}
	ids := make([]string, 0, len(models))
	byID := make(map[string]*Model, len(models))
	for index := range models {
		ids = append(ids, models[index].ID)
		byID[models[index].ID] = &models[index]
	}
	rows, err := database.Reader(ctx, p.pool).Query(ctx, `
		SELECT resource_id, user_id, group_id
		FROM resource_access_grants
		WHERE resource_type = 'model' AND resource_id::text = ANY($1)
		ORDER BY resource_id, id
	`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var resourceID string
		var userID, groupID *string
		if err := rows.Scan(&resourceID, &userID, &groupID); err != nil {
			return err
		}
		item := byID[resourceID]
		if userID != nil {
			item.Authorization.UserIDs = append(item.Authorization.UserIDs, *userID)
		}
		if groupID != nil {
			item.Authorization.GroupIDs = append(item.Authorization.GroupIDs, *groupID)
		}
	}
	return rows.Err()
}

func replaceGrants(ctx context.Context, tx pgx.Tx, item Model) error {
	grantorUserID := item.GrantorUserID
	if grantorUserID == "" {
		grantorUserID = item.OwnerUserID
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM resource_access_grants
		WHERE resource_type = 'model' AND resource_id = $1
	`, item.ID); err != nil {
		return err
	}
	for _, userID := range item.Authorization.UserIDs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO resource_access_grants (
				resource_type, resource_id, user_id, access_level, granted_by_user_id
			) VALUES ('model', $1, $2, 'read_only', $3)
		`, item.ID, userID, grantorUserID); err != nil {
			return fmt.Errorf("保存用户授权: %w", err)
		}
	}
	for _, groupID := range item.Authorization.GroupIDs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO resource_access_grants (
				resource_type, resource_id, group_id, access_level, granted_by_user_id
			) VALUES ('model', $1, $2, 'read_only', $3)
		`, item.ID, groupID, grantorUserID); err != nil {
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
