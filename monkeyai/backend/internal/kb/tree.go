package kb

import (
	"context"
	"errors"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/jackc/pgx/v5"
)

func buildDocumentTree(items []resource.Object) []resource.Object {
	nodes := make(map[string]resource.Object, len(items))
	children := map[string][]resource.Object{}
	for _, item := range items {
		node := resource.Object{}
		for key, value := range item {
			node[key] = value
		}
		node["children"] = []resource.Object{}
		nodes[node.String("id")] = node
	}
	var roots []resource.Object
	for _, item := range items {
		node := nodes[item.String("id")]
		parentID := item.String("parent_id")
		if parentID == "" || nodes[parentID] == nil {
			roots = append(roots, node)
			continue
		}
		children[parentID] = append(children[parentID], node)
	}
	for id, node := range nodes {
		node["children"] = children[id]
	}
	if roots == nil {
		return []resource.Object{}
	}
	return roots
}

func publicDocumentTree(items []resource.Object) []resource.Object {
	out := make([]resource.Object, 0, len(items))
	for _, item := range items {
		node := publicDocumentSummary(item)
		raw, _ := item["children"].([]resource.Object)
		node["children"] = publicDocumentTree(raw)
		out = append(out, node)
	}
	return out
}

func normalizeParentID(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	id := strings.TrimSpace(*value)
	if id == "" {
		return nil, nil
	}
	return &id, nil
}

func (s *Service) MoveDocument(ctx context.Context, kbID, id string, input MoveDocumentInput) (resource.Object, error) {
	return s.moveDocument(ctx, kbID, id, input, "")
}
func (s *Service) moveDocument(ctx context.Context, kbID, id string, input MoveDocumentInput, actor string) (resource.Object, error) {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx, id)
	queries := sqlc.New(tx)
	current, err := lockDocument(ctx, queries, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && current.String("kb_id") != kbID) {
		return nil, resource.NotFound
	}
	if err != nil {
		return nil, err
	}
	if err = requireContentWrite(ctx, tx, kbID, actor); err != nil {
		return nil, err
	}
	if err = requireDocumentVersion(ctx, tx, current, actor, input.ExpectedRevision); err != nil {
		return nil, err
	}
	parentID, err := normalizeParentID(input.ParentID)
	if err != nil {
		return nil, err
	}
	nodes, err := resource.DecodeObjects(queries.ListKbDocuments(ctx, kbID))
	if err != nil {
		return nil, err
	}
	if parentID != nil {
		if *parentID == id || documentDescendsFrom(nodes, *parentID, id) {
			return nil, resource.Invalid("不能移动到自身或子节点下")
		}
		parent, err := queries.GetKbDocument(ctx, *parentID)
		item, decodeErr := resource.DecodeObject(parent, err)
		if errors.Is(err, pgx.ErrNoRows) || (decodeErr == nil && item.String("kb_id") != kbID) {
			return nil, resource.Invalid("父节点不存在")
		}
		if err != nil {
			return nil, err
		}
		if decodeErr != nil {
			return nil, decodeErr
		}
		if item.String("node_type") != "folder" {
			return nil, resource.Invalid("只能放到文件夹下")
		}
	}
	position, err := documentMovePosition(ctx, queries, kbID, parentID, input.PrevID, input.NextID)
	if err != nil {
		return nil, err
	}
	if err = queries.MoveKbDocument(ctx, sqlc.MoveKbDocumentParams{ID: id, ParentID: parentID, Position: position}); err != nil {
		return nil, err
	}
	if err = bumpDocumentVersion(ctx, tx, current); err != nil {
		return nil, err
	}
	if err = recordContentChange(ctx, tx, actor, kbID, id, "move"); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetDocument(ctx, id)
}

func documentDescendsFrom(items []resource.Object, nodeID, ancestorID string) bool {
	parents := map[string]string{}
	for _, item := range items {
		parents[item.String("id")] = item.String("parent_id")
	}
	seen := map[string]bool{}
	for nodeID != "" && !seen[nodeID] {
		if nodeID == ancestorID {
			return true
		}
		seen[nodeID] = true
		nodeID = parents[nodeID]
	}
	return false
}

func documentMovePosition(ctx context.Context, queries *sqlc.Queries, kbID string, parentID *string, prevID, nextID string) (float64, error) {
	prevID = strings.TrimSpace(prevID)
	nextID = strings.TrimSpace(nextID)
	var prev, next float64
	var hasPrev, hasNext bool
	if prevID != "" {
		item, err := siblingPosition(ctx, queries, kbID, parentID, prevID)
		if err != nil {
			return 0, err
		}
		prev, hasPrev = item, true
	}
	if nextID != "" {
		item, err := siblingPosition(ctx, queries, kbID, parentID, nextID)
		if err != nil {
			return 0, err
		}
		next, hasNext = item, true
	}
	switch {
	case hasPrev && hasNext:
		return (prev + next) / 2, nil
	case hasPrev:
		return prev + 1000, nil
	case hasNext:
		return next - 1000, nil
	default:
		return queries.NextKbDocumentPosition(ctx, sqlc.NextKbDocumentPositionParams{KbID: kbID, ParentID: parentID})
	}
}

func siblingPosition(ctx context.Context, queries *sqlc.Queries, kbID string, parentID *string, id string) (float64, error) {
	raw, err := queries.GetKbDocument(ctx, id)
	item, decodeErr := resource.DecodeObject(raw, err)
	if errors.Is(err, pgx.ErrNoRows) || decodeErr != nil && err == nil {
		if decodeErr != nil {
			return 0, decodeErr
		}
		return 0, resource.Invalid("相邻节点不存在")
	}
	if err != nil {
		return 0, err
	}
	if item.String("kb_id") != kbID || item.String("parent_id") != deref(parentID) {
		return 0, resource.Invalid("相邻节点不在同一层级")
	}
	return objectFloat(item["position"]), nil
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func objectFloat(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int32:
		return float64(typed)
	case int64:
		return float64(typed)
	default:
		return 0
	}
}

const maxBatchDocuments = 200

type BatchDocumentInput struct {
	ExpectedRevisions map[string]int64 `json:"expected_revisions,omitempty"`
	Action            string           `json:"action"`
	IDs               []string         `json:"ids"`
	ParentID          *string          `json:"parent_id"`
}

type BatchDocumentFailure struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

type BatchDocumentResult struct {
	Succeeded []string               `json:"succeeded"`
	Failed    []BatchDocumentFailure `json:"failed"`
}

func (s *Service) BatchDocuments(ctx context.Context, kbID string, input BatchDocumentInput) (BatchDocumentResult, error) {
	return s.batchDocuments(ctx, kbID, input, "")
}
func (s *Service) batchDocuments(ctx context.Context, kbID string, input BatchDocumentInput, actor string) (BatchDocumentResult, error) {
	ids, err := normalizeBatchIDs(input.IDs)
	if err != nil {
		return BatchDocumentResult{}, err
	}
	switch input.Action {
	case "delete":
		return s.batchDeleteDocuments(ctx, kbID, ids, actor, input.ExpectedRevisions)
	case "move":
		return s.batchMoveDocuments(ctx, kbID, ids, input.ParentID, actor, input.ExpectedRevisions)
	default:
		return BatchDocumentResult{}, resource.Invalid("不支持的批量操作")
	}
}

func normalizeBatchIDs(ids []string) ([]string, error) {
	seen := map[string]bool{}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	if len(out) == 0 {
		return nil, resource.Invalid("请选择要操作的内容")
	}
	if len(out) > maxBatchDocuments {
		return nil, resource.Invalid("单次最多操作 200 个内容")
	}
	return out, nil
}

func (s *Service) batchDeleteDocuments(ctx context.Context, kbID string, ids []string, actor string, expected map[string]int64) (BatchDocumentResult, error) {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return BatchDocumentResult{}, err
	}
	defer rollback(ctx, tx, strings.Join(ids, ","))
	queries := sqlc.New(tx)
	if _, err = queries.LockKbResource(ctx, kbID); err != nil {
		return BatchDocumentResult{}, err
	}
	if err = requireContentWrite(ctx, tx, kbID, actor); err != nil {
		return BatchDocumentResult{}, err
	}
	nodes, err := resource.DecodeObjects(queries.ListKbDocuments(ctx, kbID))
	if err != nil {
		return BatchDocumentResult{}, err
	}
	byID := map[string]resource.Object{}
	children := map[string][]string{}
	for _, node := range nodes {
		id := node.String("id")
		byID[id] = node
		children[node.String("parent_id")] = append(children[node.String("parent_id")], id)
	}
	if actor != "" {
		for _, id := range ids {
			node, exists := byID[id]
			if !exists {
				return BatchDocumentResult{}, resource.NotFound
			}
			if err = requireDocumentVersion(ctx, tx, node, actor, expected[id]); err != nil {
				return BatchDocumentResult{}, err
			}
		}
	}
	selected := map[string]bool{}
	result := BatchDocumentResult{Succeeded: []string{}, Failed: []BatchDocumentFailure{}}
	for _, id := range ids {
		node, ok := byID[id]
		if !ok || node.String("kb_id") != kbID {
			result.Failed = append(result.Failed, BatchDocumentFailure{ID: id, Reason: "内容不存在"})
			continue
		}
		selected[id] = true
	}
	order := batchDeleteOrder(ids, selected, children)
	for _, id := range order {
		if _, err = lockDocument(ctx, queries, id); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				if selected[id] {
					result.Failed = append(result.Failed, BatchDocumentFailure{ID: id, Reason: "内容不存在"})
				}
				continue
			}
			return BatchDocumentResult{}, err
		}
		if err = queries.CancelKbLearningJobsByDocument(ctx, &id); err != nil {
			return BatchDocumentResult{}, err
		}
		if err = queries.DeleteKbChunksByDocument(ctx, id); err != nil {
			return BatchDocumentResult{}, err
		}
		deleted, err := queries.SoftDeleteKbDocument(ctx, id)
		if err != nil {
			return BatchDocumentResult{}, err
		}
		if deleted == 0 {
			if selected[id] {
				result.Failed = append(result.Failed, BatchDocumentFailure{ID: id, Reason: "内容不存在"})
			}
			continue
		}
		if err = recordContentChange(ctx, tx, actor, kbID, id, "delete"); err != nil {
			return BatchDocumentResult{}, err
		}
		if selected[id] {
			result.Succeeded = append(result.Succeeded, id)
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return BatchDocumentResult{}, err
	}
	return result, nil
}

func batchDeleteOrder(ids []string, selected map[string]bool, children map[string][]string) []string {
	seen := map[string]bool{}
	var order []string
	var visit func(string)
	visit = func(id string) {
		if seen[id] {
			return
		}
		seen[id] = true
		for _, child := range children[id] {
			visit(child)
		}
		order = append(order, id)
	}
	for _, id := range ids {
		if selected[id] {
			visit(id)
		}
	}
	return order
}

func (s *Service) batchMoveDocuments(ctx context.Context, kbID string, ids []string, parentID *string, actor string, expected map[string]int64) (BatchDocumentResult, error) {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return BatchDocumentResult{}, err
	}
	defer rollback(ctx, tx, strings.Join(ids, ","))
	queries := sqlc.New(tx)
	if _, err = queries.LockKbResource(ctx, kbID); err != nil {
		return BatchDocumentResult{}, err
	}
	if err = requireContentWrite(ctx, tx, kbID, actor); err != nil {
		return BatchDocumentResult{}, err
	}
	nodes, err := resource.DecodeObjects(queries.ListKbDocuments(ctx, kbID))
	if err != nil {
		return BatchDocumentResult{}, err
	}
	byID := map[string]resource.Object{}
	parents := map[string]string{}
	for _, node := range nodes {
		id := node.String("id")
		byID[id] = node
		parents[id] = node.String("parent_id")
	}
	target, err := normalizeParentID(parentID)
	if err != nil {
		return BatchDocumentResult{}, err
	}
	if target != nil {
		parent, ok := byID[*target]
		if !ok || parent.String("kb_id") != kbID {
			return BatchDocumentResult{}, resource.Invalid("父节点不存在")
		}
		if parent.String("node_type") != "folder" {
			return BatchDocumentResult{}, resource.Invalid("只能放到文件夹下")
		}
	}
	if actor != "" {
		for _, id := range ids {
			node, exists := byID[id]
			if !exists {
				return BatchDocumentResult{}, resource.NotFound
			}
			if err = requireDocumentVersion(ctx, tx, node, actor, expected[id]); err != nil {
				return BatchDocumentResult{}, err
			}
		}
	}
	selected := map[string]bool{}
	result := BatchDocumentResult{Succeeded: []string{}, Failed: []BatchDocumentFailure{}}
	for _, id := range ids {
		node, ok := byID[id]
		if !ok || node.String("kb_id") != kbID {
			result.Failed = append(result.Failed, BatchDocumentFailure{ID: id, Reason: "内容不存在"})
			continue
		}
		if target != nil && (*target == id || documentDescendsFrom(nodes, *target, id)) {
			result.Failed = append(result.Failed, BatchDocumentFailure{ID: id, Reason: "不能移动到自身或子节点下"})
			continue
		}
		selected[id] = true
	}
	for _, id := range ids {
		if !selected[id] || batchAncestorSelected(id, selected, parents) {
			continue
		}
		if _, err = lockDocument(ctx, queries, id); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				result.Failed = append(result.Failed, BatchDocumentFailure{ID: id, Reason: "内容不存在"})
				continue
			}
			return BatchDocumentResult{}, err
		}
		position, err := queries.NextKbDocumentPosition(ctx, sqlc.NextKbDocumentPositionParams{KbID: kbID, ParentID: target})
		if err != nil {
			return BatchDocumentResult{}, err
		}
		if err = queries.MoveKbDocument(ctx, sqlc.MoveKbDocumentParams{ID: id, ParentID: target, Position: position}); err != nil {
			return BatchDocumentResult{}, err
		}
		if err = bumpDocumentVersion(ctx, tx, byID[id]); err != nil {
			return BatchDocumentResult{}, err
		}
		if err = recordContentChange(ctx, tx, actor, kbID, id, "move"); err != nil {
			return BatchDocumentResult{}, err
		}
		result.Succeeded = append(result.Succeeded, id)
	}
	if err = tx.Commit(ctx); err != nil {
		return BatchDocumentResult{}, err
	}
	return result, nil
}

func batchAncestorSelected(id string, selected map[string]bool, parents map[string]string) bool {
	seen := map[string]bool{}
	for parent := parents[id]; parent != "" && !seen[parent]; parent = parents[parent] {
		if selected[parent] {
			return true
		}
		seen[parent] = true
	}
	return false
}
