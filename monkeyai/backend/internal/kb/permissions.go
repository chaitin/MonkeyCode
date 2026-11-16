package kb

import (
	"context"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

type Permissions struct {
	EffectiveAccessLevel   string `json:"effective_access_level"`
	CanRead                bool   `json:"can_read"`
	CanWriteContent        bool   `json:"can_write_content"`
	CanManagePermissions   bool   `json:"can_manage_permissions"`
	CanManageKnowledgeBase bool   `json:"can_manage_knowledge_base"`
	CanDeleteKnowledgeBase bool   `json:"can_delete_knowledge_base"`
}

func resolvePermissions(ctx context.Context, q resource.Queryer, item resource.Object, actor string) (Permissions, error) {
	p := Permissions{}
	active, err := sqlc.New(q).KbActorActive(ctx, actor)
	if err != nil || !active {
		return p, err
	}
	owner := item.String("ownership_type") == "user" && item.String("owner_user_id") == actor
	p.CanManagePermissions, p.CanManageKnowledgeBase, p.CanDeleteKnowledgeBase = owner, owner, owner
	if !item.Bool("enabled") {
		return p, nil
	}
	if item.String("ownership_type") == "system" {
		ok, err := resource.CanUseSystem(ctx, q, actor)
		if err != nil || !ok {
			return p, err
		}
	}
	level := int32(2)
	if !owner {
		level, err = sqlc.New(q).KbContentAccess(ctx, sqlc.KbContentAccessParams{Actor: actor, KbID: item.String("id")})
		if err != nil {
			return p, err
		}
	}
	p.CanRead, p.CanWriteContent = level > 0, level > 1
	if p.CanWriteContent {
		p.EffectiveAccessLevel = "read_write"
	} else if p.CanRead {
		p.EffectiveAccessLevel = "read_only"
	}
	return p, nil
}

// requireContentWrite runs after locking the KB, serializing writes with revocation.
// An empty actor is reserved for existing trusted management/internal callers.
func requireContentWrite(ctx context.Context, q resource.Queryer, kbID, actor string) error {
	if actor == "" {
		return nil
	}
	item, err := resource.DecodeObject(sqlc.New(q).LockKbResource(ctx, kbID))
	if err != nil {
		return err
	}
	p, err := resolvePermissions(ctx, q, item, actor)
	if err != nil {
		return err
	}
	if !p.CanRead {
		return resource.NotFound
	}
	if !p.CanWriteContent {
		return &resource.Error{Status: http.StatusForbidden, Code: "kb_write_forbidden", Message: "知识库仅有只读权限"}
	}
	return nil
}

func (s *Service) decoratePermissions(ctx context.Context, item resource.Object, actor string) error {
	raw, err := resource.DecodeObject(sqlc.New(s.store.Pool).GetKbResource(ctx, item.String("id")))
	if err != nil {
		return err
	}
	p, err := resolvePermissions(ctx, s.store.Pool, raw, actor)
	if err != nil {
		return err
	}
	item["permissions"] = p
	return nil
}

func checkDocumentVersion(current resource.Object, expected int64) error {
	if expected < 0 {
		return resource.Invalid("文档版本无效")
	}
	if expected != 0 && expected != objectInt64(current["revision"]) {
		return &resource.Error{Status: 412, Code: "document_revision_conflict", Message: "文档已更新，请刷新后重试"}
	}
	return nil
}

func recordContentChange(ctx context.Context, tx pgx.Tx, actor, kbID, documentID, action string) error {
	if actor == "" {
		if user, ok := identity.UserFromContext(ctx); ok {
			actor = user.ID
		}
	}
	if actor == "" {
		return nil
	}
	if action != "delete" {
		if err := sqlc.New(tx).TouchKbDocumentAuthor(ctx, sqlc.TouchKbDocumentAuthorParams{ID: documentID, UpdatedByUserID: &actor}); err != nil {
			return err
		}
	}
	return audit.Write(ctx, tx, audit.Event{ActorID: actor, Category: "resource", Action: action, TargetType: "kb", TargetID: kbID, Params: resource.Object{"document_id": documentID}})
}

func requireDocumentVersion(ctx context.Context, q resource.Queryer, current resource.Object, actor string, expected int64) error {
	if err := checkDocumentVersion(current, expected); err != nil {
		return err
	}
	if actor == "" || expected > 0 {
		return nil
	}
	item, err := resource.DecodeObject(sqlc.New(q).GetKbResource(ctx, current.String("kb_id")))
	if err != nil {
		return err
	}
	if item.String("ownership_type") == "user" && item.String("owner_user_id") == actor {
		return nil
	}
	return &resource.Error{Status: 428, Code: "precondition_required", Message: "请先读取文档并提供 expected_revision"}
}

// Metadata and tree edits also invalidate stale editors. If they invalidate an
// in-flight learning snapshot, replace that job rather than leaving it stranded.
func bumpDocumentVersion(ctx context.Context, tx pgx.Tx, current resource.Object) error {
	queries := sqlc.New(tx)
	id := current.String("id")
	previous := int32(objectInt64(current["revision"]))
	revision, err := queries.GetKbDocumentRevision(ctx, id)
	if err != nil || revision != previous {
		return err
	}
	if err = queries.BumpKbDocumentRevision(ctx, sqlc.BumpKbDocumentRevisionParams{ID: id, Revision: previous}); err != nil {
		return err
	}
	if current.String("node_type") == "folder" || (current.String("status") != "pending" && current.String("status") != "learning") {
		return nil
	}
	if err = queries.CancelKbLearningJobsByDocument(ctx, &id); err != nil {
		return err
	}
	binding, err := queries.GetKbEmbedding(ctx, current.String("kb_id"))
	if err != nil {
		return err
	}
	modelID, dimension := embeddingBindingTarget(binding.EmbeddingModelID, binding.EmbeddingDimension)
	return createKbDocumentJob(ctx, queries, current.String("kb_id"), id, OperationRelearn, previous+1, modelID, dimension)
}

// Embedding requests may outlive a grant. Recheck before returning retrieved text.
func (s *Service) searchWithPermissionRecheck(ctx context.Context, actor string, accessible []resource.Object, input SearchInput) (SearchResponse, error) {
	response, err := s.searchAccessible(ctx, accessible, input)
	if err != nil {
		return SearchResponse{}, err
	}
	checked := map[string]bool{}
	for _, result := range response.Items {
		id := result.String("kb_id")
		if checked[id] {
			continue
		}
		if _, err = s.accessibleKB(ctx, actor, id); err != nil {
			return SearchResponse{}, err
		}
		checked[id] = true
	}
	return response, nil
}
