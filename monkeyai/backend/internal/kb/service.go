package kb

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/jackc/pgx/v5"
)

type Service struct {
	CRUD    *resource.CRUD
	store   *resource.Store
	models  Embedder
	worker  string
	storage resource.Storage
	syncMu  sync.Mutex
}

type Embedder interface {
	EmbedText(context.Context, string, string) (model.EmbeddingResult, error)
}

func NewService(store *resource.Store, models *model.Service) *Service {
	s := &Service{store: store, models: models, worker: resource.ID()}
	s.CRUD = resource.NewCRUD(store, resource.Definition{
		Kind:           "kb",
		Path:           "/kb",
		Repository:     func(q resource.Queryer) resource.Repository { return newRepository(q) },
		Fields:         []string{"name", "description", "enabled", "embedding_model_id", "embedding_dimension", "fusion_config"},
		UserFields:     []string{"name", "description", "fusion_config", "tag_ids", avatarChangeKey},
		OverrideFields: []string{"name", "description"},
		Hidden:         []string{"avatar_s3_key"},
		Persist:        s.persistAvatar,
		Validate:       s.validate,
		Decorate:       s.decorate,
		DeleteFunc:     s.Delete,
	})
	return s
}

func (s *Service) validate(ctx context.Context, tx pgx.Tx, in, old resource.Object) error {
	if avatar, ok := in[avatarChangeKey].(*avatarChange); ok {
		avatar.old = old.String("avatar_s3_key")
	}
	// Model bindings are index metadata owned by the backend, not user settings.
	modelID := old.String("embedding_model_id")
	dimension := int(objectInt64(old["embedding_dimension"]))
	if old.String("id") == "" {
		var err error
		modelID, dimension, err = s.resolveEmbeddingModel(ctx, tx, "")
		if err != nil {
			return err
		}
	}
	if modelID != "" {
		in["embedding_model_id"] = modelID
		in["embedding_dimension"] = dimension
	} else {
		in["embedding_model_id"] = nil
		in["embedding_dimension"] = nil
	}

	fusion := defaultFusionConfig()
	if old.String("id") != "" {
		fusion = kbFusionConfig(old)
	}
	if raw, ok := in["fusion_config"]; ok {
		validated, err := validateFusionConfig(raw)
		if err != nil {
			return err
		}
		fusion = validated
	}
	in["fusion_config"] = fusion
	if strings.TrimSpace(in.String("description")) == "" {
		in["description"] = ""
	}
	return nil
}

func (s *Service) decorate(ctx context.Context, q resource.Queryer, item resource.Object) error {
	if key := item.String("avatar_s3_key"); key != "" {
		item["avatar_path"] = "/api/admin/v1/kb/" + item.String("id") + "/avatar?v=" + resource.Hash(key)
	}
	count, err := sqlc.New(q).CountKbDocuments(ctx, item.String("id"))
	if err != nil {
		return err
	}
	item["document_count"] = count.Total
	item["learned_count"] = count.Learned
	decorateRetrievalCapabilities(item)
	summary := resource.Object{
		"pending":      int64(0),
		"running":      int64(0),
		"failed":       int64(0),
		"by_operation": resource.Object{},
	}
	jobs, err := sqlc.New(q).CountKbLearningJobs(ctx, item.String("id"))
	if err != nil {
		return err
	}
	byOperation := map[string]any{}
	for _, job := range jobs {
		switch job.Status {
		case "pending":
			summary["pending"] = objectInt64(summary["pending"]) + job.Total
		case "running":
			summary["running"] = objectInt64(summary["running"]) + job.Total
		case "failed":
			summary["failed"] = objectInt64(summary["failed"]) + job.Total
		}
		operations, _ := byOperation[job.Operation].(map[string]any)
		if operations == nil {
			operations = map[string]any{}
		}
		operations[job.Status] = job.Total
		byOperation[job.Operation] = operations
	}
	summary["by_operation"] = byOperation
	item["index_job_summary"] = summary
	return nil
}

func (s *Service) resolveEmbeddingModel(ctx context.Context, q resource.Queryer, requested string) (string, int, error) {
	selected, err := sqlc.New(q).SelectKbEmbeddingModel(ctx, strings.TrimSpace(requested))
	if errors.Is(err, pgx.ErrNoRows) {
		return "", 0, nil
	}
	if err != nil {
		return "", 0, err
	}
	return selected.ID, int(selected.Dimension), nil
}

func (s *Service) List(ctx context.Context, ownership, query, cursor string, limit int) ([]resource.Object, string, error) {
	items, err := s.CRUD.List(ctx, s.store.Pool)
	if err != nil {
		return nil, "", err
	}
	query = strings.ToLower(strings.TrimSpace(query))
	filtered := make([]resource.Object, 0, len(items))
	for _, item := range items {
		if ownership != "" && item.String("ownership_type") != ownership {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(item.String("name")), query) &&
			!strings.Contains(strings.ToLower(item.String("description")), query) {
			continue
		}
		filtered = append(filtered, item)
	}
	sort.SliceStable(filtered, func(i, j int) bool {
		left := strings.ToLower(filtered[i].String("name"))
		right := strings.ToLower(filtered[j].String("name"))
		if left != right {
			return left < right
		}
		return filtered[i].String("id") < filtered[j].String("id")
	})
	start := 0
	if cursor != "" {
		for i, item := range filtered {
			if item.String("id") == cursor {
				start = i + 1
				break
			}
		}
	}
	if start > len(filtered) {
		start = len(filtered)
	}
	end := min(start+limit, len(filtered))
	next := ""
	if end < len(filtered) && end > start {
		next = filtered[end-1].String("id")
	}
	return filtered[start:end], next, nil
}

func (s *Service) Get(ctx context.Context, id string) (resource.Object, error) {
	return s.CRUD.Get(ctx, s.store.Pool, id)
}

func (s *Service) ListAccessible(ctx context.Context, userID string) ([]resource.Object, error) {
	return s.listAccessible(ctx, userID, resource.CatalogFilter{})
}

func (s *Service) listKnowledgeBasePage(ctx context.Context, userID string, filter resource.CatalogFilter, tagIDs []string, page, size int) (map[string]any, error) {
	items, err := s.listAccessible(ctx, userID, filter)
	if err != nil {
		return nil, err
	}
	out := make([]resource.Object, 0, len(items))
	for _, item := range items {
		if item.Bool("enabled") {
			out = append(out, publicKBList(item, userID))
		}
	}
	out = resource.FilterTags(out, tagIDs)
	resource.StableByName(out)
	return map[string]any{
		"knowledge_bases": resource.PageSlice(out, page, size),
		"total_count":     len(out),
		"page":            page,
		"page_size":       size,
	}, nil
}

func (s *Service) listAccessible(ctx context.Context, userID string, filter resource.CatalogFilter) ([]resource.Object, error) {
	raw, err := resource.DecodeObjects(newRepository(s.store.Pool).ListResources(ctx))
	if err != nil {
		return nil, err
	}
	out := make([]resource.Object, 0, len(raw))
	for _, item := range raw {
		if !item.Bool("enabled") {
			continue
		}
		if !filter.Matches(item.String("ownership_type"), item.String("owner_user_id"), userID, item.String("name"), item.String("description")) {
			continue
		}
		permission, err := resolvePermissions(ctx, s.store.Pool, item, userID)
		if err != nil {
			return nil, err
		}
		if !permission.CanRead {
			continue
		}
		decorated, err := s.CRUD.Get(ctx, s.store.Pool, item.String("id"))
		if err != nil {
			return nil, err
		}
		if err = s.decoratePermissions(ctx, decorated, userID); err != nil {
			return nil, err
		}
		out = append(out, decorated)
	}
	return out, nil
}

func (s *Service) GetAccessible(ctx context.Context, id, userID string) (resource.Object, error) {
	item, err := resource.DecodeObject(newRepository(s.store.Pool).GetResource(ctx, id))
	if err != nil {
		return nil, err
	}
	if !item.Bool("enabled") {
		return nil, resource.NotFound
	}
	permission, err := resolvePermissions(ctx, s.store.Pool, item, userID)
	if err != nil {
		return nil, err
	}
	if !permission.CanRead {
		return nil, resource.NotFound
	}
	decorated, err := s.CRUD.Get(ctx, s.store.Pool, id)
	if err != nil {
		return nil, err
	}
	if err = s.decoratePermissions(ctx, decorated, userID); err != nil {
		return nil, err
	}
	return decorated, nil
}

func (s *Service) CreateUserKB(ctx context.Context, userID string, input resource.Object) (resource.Object, error) {
	item, err := s.CRUD.SaveUser(ctx, userID, "", "", input)
	if err != nil {
		return nil, err
	}
	if err = s.decoratePermissions(ctx, item, userID); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Service) UpdateUserKB(ctx context.Context, userID, id, match string, input resource.Object) (resource.Object, error) {
	return s.CRUD.SaveUser(ctx, userID, strings.TrimSpace(id), match, input)
}

func (s *Service) DeleteUserKB(ctx context.Context, userID, id, match string) error {
	return s.deleteKB(ctx, userID, strings.TrimSpace(id), match, true)
}

func (s *Service) Delete(ctx context.Context, actor, id, match string) error {
	return s.deleteKB(ctx, actor, id, match, false)
}

func (s *Service) deleteKB(ctx context.Context, actor, id, match string, personal bool) error {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx, id)
	data, err := sqlc.New(tx).LockKbResource(ctx, id)
	if err != nil {
		return err
	}
	item, err := resource.DecodeObject(data, nil)
	if err != nil {
		return err
	}
	if personal {
		if item.String("ownership_type") != "user" || item.String("owner_user_id") != actor {
			return resource.NotFound
		}
		if match == "" {
			return &resource.Error{Status: http.StatusPreconditionRequired, Code: "precondition_required", Message: "删除需要 If-Match"}
		}
	} else if item.String("ownership_type") != "system" {
		return resource.Invalid("个人知识库仅允许治理删除")
	}
	if err = resource.RequireEditable(ctx, tx, "kb", id); err != nil {
		return err
	}
	if match != fmt.Sprintf(`"%v"`, item["revision"]) {
		return resource.Conflict
	}
	queries := sqlc.New(tx)
	if err = queries.DeleteKbLearningJobsByKb(ctx, id); err != nil {
		return err
	}
	if err = queries.DeleteKbChunksByKb(ctx, id); err != nil {
		return err
	}
	if err = queries.SoftDeleteKbDocumentsByKb(ctx, id); err != nil {
		return err
	}
	if err = resource.DeleteRelations(ctx, tx, "kb", id); err != nil {
		return err
	}
	if err = newRepository(tx).DeleteResource(ctx, id); err != nil {
		return err
	}
	if err = resource.Audit(ctx, tx, actor, "kb", id, "delete"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) SetEnabled(ctx context.Context, actor, id, match string, enabled bool) (resource.Object, error) {
	return s.CRUD.SetEnabled(ctx, actor, id, match, enabled)
}

func rollback(ctx context.Context, tx pgx.Tx, _ string) {
	_ = tx.Rollback(ctx)
}

func (s *Service) WithStorage(storage resource.Storage) *Service {
	s.storage = storage
	return s
}
func (s *Service) persistAvatar(ctx context.Context, tx pgx.Tx, in resource.Object) error {
	if avatar, ok := in[avatarChangeKey].(*avatarChange); ok {
		return sqlc.New(tx).SetAvatar(ctx, sqlc.SetAvatarParams{ID: in.String("id"), AvatarS3Key: avatar.key})
	}
	return nil
}
