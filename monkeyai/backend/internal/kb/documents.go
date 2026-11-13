package kb

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/jackc/pgx/v5"
)

const (
	documentDefaultPageSize = 20
	documentMaxPageSize     = 100
	documentMaxPage         = 1000000
)

var documentStatuses = []string{"pending", "learning", "learned", "failed"}
var documentSourceTypes = []string{"text", "file", "url"}

type DocumentInput struct {
	ExpectedRevision int64   `json:"expected_revision,omitempty"`
	KbID             string  `json:"kb_id"`
	ParentID         *string `json:"parent_id"`
	NodeType         string  `json:"node_type"`
	Title            string  `json:"title"`
	SourceType       string  `json:"source_type"`
	Content          string  `json:"content"`
	FileName         string  `json:"file_name"`
	MimeType         string  `json:"mime_type"`
	SizeBytes        int64   `json:"size_bytes"`
}

type MoveDocumentInput struct {
	ExpectedRevision int64   `json:"expected_revision,omitempty"`
	ParentID         *string `json:"parent_id"`
	PrevID           string  `json:"prev_id"`
	NextID           string  `json:"next_id"`
}

type DocumentListFilter struct {
	Query      string
	Status     string
	SourceType string
	Page       int
	PageSize   int
}

type DocumentPage struct {
	Items      []resource.Object `json:"items"`
	TotalCount int               `json:"total_count"`
	Page       int               `json:"page"`
	PageSize   int               `json:"page_size"`
}

type SearchInput struct {
	KbIDs   []string       `json:"kb_ids"`
	Query   string         `json:"query"`
	TopK    int            `json:"top_k"`
	Filters map[string]any `json:"filters"`
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func embeddingBindingTarget(modelID *string, dimension *int32) (string, int) {
	targetModel := ""
	if modelID != nil {
		targetModel = strings.TrimSpace(*modelID)
	}
	targetDimension := 0
	if dimension != nil {
		targetDimension = int(*dimension)
	}
	return targetModel, targetDimension
}

func documentHasChunks(document resource.Object) bool {
	return objectInt64(document["chunk_count"]) > 0
}

func (s *Service) GetDocument(ctx context.Context, id string) (resource.Object, error) {
	return resource.DecodeObject(sqlc.New(s.store.Pool).GetKbDocument(ctx, id))
}

func (s *Service) ListDocuments(ctx context.Context, kbID string) ([]resource.Object, error) {
	items, err := resource.DecodeObjects(sqlc.New(s.store.Pool).ListKbDocuments(ctx, kbID))
	if err != nil {
		return nil, err
	}
	return buildDocumentTree(items), nil
}

func (s *Service) ListDocumentNodes(ctx context.Context, kbID string) ([]resource.Object, error) {
	return resource.DecodeObjects(sqlc.New(s.store.Pool).ListKbDocuments(ctx, kbID))
}

func (s *Service) ListChunks(ctx context.Context, documentID string) ([]resource.Object, error) {
	return resource.DecodeObjects(sqlc.New(s.store.Pool).ListKbChunks(ctx, documentID))
}

func (s *Service) accessibleKB(ctx context.Context, userID, kbID string) (resource.Object, error) {
	kbID = strings.TrimSpace(kbID)
	if kbID == "" {
		return nil, resource.NotFound
	}
	raw, err := newRepository(s.store.Pool).GetResource(ctx, kbID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, resource.NotFound
	}
	if err != nil {
		return nil, err
	}
	item, err := resource.DecodeObject(raw, nil)
	if err != nil {
		return nil, err
	}
	permission, err := resolvePermissions(ctx, s.store.Pool, item, userID)
	if err != nil {
		return nil, err
	}
	if !permission.CanRead {
		return nil, resource.NotFound
	}
	return s.CRUD.Get(ctx, s.store.Pool, kbID)
}

func (s *Service) ownedUserKB(ctx context.Context, userID, kbID string) (resource.Object, error) {
	item, err := s.CRUD.GetUser(ctx, s.store.Pool, strings.TrimSpace(kbID), userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, resource.NotFound
	}
	return item, err
}

func (s *Service) GetAccessibleDocument(ctx context.Context, userID, documentID string) (resource.Object, error) {
	item, err := s.GetDocument(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, resource.NotFound
	}
	if err != nil {
		return nil, err
	}
	if _, err := s.accessibleKB(ctx, userID, item.String("kb_id")); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Service) GetAccessibleDocumentInKB(ctx context.Context, userID, kbID, documentID string) (resource.Object, error) {
	kbID = strings.TrimSpace(kbID)
	item, err := s.GetAccessibleDocument(ctx, userID, documentID)
	if err != nil {
		return nil, err
	}
	if item.String("kb_id") != kbID {
		return nil, resource.NotFound
	}
	return item, nil
}

func (s *Service) ListAccessibleDocuments(ctx context.Context, userID, kbID string, filter DocumentListFilter) (DocumentPage, error) {
	kbID = strings.TrimSpace(kbID)
	if _, err := s.accessibleKB(ctx, userID, kbID); err != nil {
		return DocumentPage{}, err
	}
	items, err := s.ListDocumentNodes(ctx, kbID)
	if err != nil {
		return DocumentPage{}, err
	}
	if strings.TrimSpace(filter.Query) == "" && strings.TrimSpace(filter.Status) == "" && strings.TrimSpace(filter.SourceType) == "" && filter.Page == 0 && filter.PageSize == 0 {
		tree := publicDocumentTree(buildDocumentTree(items))
		return DocumentPage{Items: tree, TotalCount: len(tree), Page: 1, PageSize: len(tree)}, nil
	}
	return filterDocumentPage(items, filter)
}

func filterDocumentPage(items []resource.Object, filter DocumentListFilter) (DocumentPage, error) {
	normalized, err := normalizeDocumentListFilter(filter)
	if err != nil {
		return DocumentPage{}, err
	}
	query := strings.ToLower(normalized.Query)
	filtered := make([]resource.Object, 0, len(items))
	for _, item := range items {
		if normalized.Status != "" && item.String("status") != normalized.Status {
			continue
		}
		if normalized.SourceType != "" && item.String("source_type") != normalized.SourceType {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(item.String("title")), query) && !strings.Contains(strings.ToLower(item.String("file_name")), query) {
			continue
		}
		filtered = append(filtered, item)
	}
	selected := resource.PageSlice(filtered, normalized.Page, normalized.PageSize)
	out := make([]resource.Object, 0, len(selected))
	for _, item := range selected {
		out = append(out, publicDocumentSummary(item))
	}
	return DocumentPage{
		Items:      out,
		TotalCount: len(filtered),
		Page:       normalized.Page,
		PageSize:   normalized.PageSize,
	}, nil
}

func normalizeDocumentListFilter(filter DocumentListFilter) (DocumentListFilter, error) {
	filter.Query = strings.TrimSpace(filter.Query)
	filter.Status = strings.ToLower(strings.TrimSpace(filter.Status))
	filter.SourceType = strings.ToLower(strings.TrimSpace(filter.SourceType))
	if filter.Status != "" && !containsString(documentStatuses, filter.Status) {
		return DocumentListFilter{}, resource.Invalid("status 必须为 pending、learning、learned 或 failed")
	}
	if filter.SourceType != "" && !containsString(documentSourceTypes, filter.SourceType) {
		return DocumentListFilter{}, resource.Invalid("source_type 必须为 text、file 或 url")
	}
	if filter.Page == 0 {
		filter.Page = 1
	}
	if filter.Page < 1 || filter.Page > documentMaxPage {
		return DocumentListFilter{}, resource.Invalid("page 无效")
	}
	if filter.PageSize == 0 {
		filter.PageSize = documentDefaultPageSize
	}
	if filter.PageSize < 1 || filter.PageSize > documentMaxPageSize {
		return DocumentListFilter{}, resource.Invalid("page_size 无效")
	}
	return filter, nil
}

func (s *Service) ownedUserDocument(ctx context.Context, userID, documentID string) (resource.Object, error) {
	item, err := s.GetDocument(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, resource.NotFound
	}
	if err != nil {
		return nil, err
	}
	if _, err := s.ownedUserKB(ctx, userID, item.String("kb_id")); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Service) CreateUserDocument(ctx context.Context, userID string, input DocumentInput) (resource.Object, error) {
	return s.createDocument(ctx, userID, input, true)
}
func (s *Service) UpdateUserDocument(ctx context.Context, userID, documentID string, input DocumentInput) (resource.Object, error) {
	return s.updateDocument(ctx, documentID, input, userID)
}
func (s *Service) DeleteUserDocument(ctx context.Context, userID, documentID string) error {
	return s.deleteDocument(ctx, documentID, userID, 0)
}

func (s *Service) CreateDocument(ctx context.Context, actor string, input DocumentInput) (resource.Object, error) {
	return s.createDocument(ctx, actor, input, false)
}
func (s *Service) createDocument(ctx context.Context, actor string, input DocumentInput, personal bool) (resource.Object, error) {
	input.KbID = strings.TrimSpace(input.KbID)
	input.Title = strings.TrimSpace(input.Title)
	input.SourceType = strings.TrimSpace(input.SourceType)
	if input.KbID == "" || input.Title == "" {
		return nil, resource.Invalid("知识库和文档标题不能为空")
	}
	if input.SourceType == "" {
		input.SourceType = "text"
	}
	if input.SourceType != "text" && input.SourceType != "file" && input.SourceType != "url" {
		return nil, resource.Invalid("文档来源类型无效")
	}
	if input.SizeBytes <= 0 {
		input.SizeBytes = int64(len(input.Content))
	}
	if strings.TrimSpace(input.NodeType) != "folder" && strings.TrimSpace(input.Content) == "" {
		return nil, resource.Invalid("文档内容不能为空")
	}
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx, input.KbID)
	queries := sqlc.New(tx)
	if _, err = queries.LockKbResource(ctx, input.KbID); err != nil {
		return nil, err
	}
	if personal {
		if err = requireContentWrite(ctx, tx, input.KbID, actor); err != nil {
			return nil, err
		}
	}
	binding, err := queries.GetKbEmbedding(ctx, input.KbID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, resource.NotFound
		}
		return nil, err
	}

	nodeType := strings.TrimSpace(input.NodeType)
	if nodeType == "" {
		nodeType = "document"
	}
	if nodeType != "document" && nodeType != "folder" {
		return nil, resource.Invalid("节点类型无效")
	}
	parentID, err := normalizeParentID(input.ParentID)
	if err != nil {
		return nil, err
	}
	if parentID != nil {
		raw, err := queries.GetKbDocument(ctx, *parentID)
		parent, decodeErr := resource.DecodeObject(raw, err)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && decodeErr == nil && parent.String("kb_id") != input.KbID) {
			return nil, resource.Invalid("父节点不存在")
		}
		if err != nil {
			return nil, err
		}
		if decodeErr != nil {
			return nil, decodeErr
		}
		if parent.String("node_type") != "folder" {
			return nil, resource.Invalid("只能放到文件夹下")
		}
	}
	position, err := queries.NextKbDocumentPosition(ctx, sqlc.NextKbDocumentPositionParams{KbID: input.KbID, ParentID: parentID})
	if err != nil {
		return nil, err
	}
	status := "pending"
	if nodeType == "folder" {
		status = "learned"
		input.SourceType = "text"
		input.Content = ""
		input.SizeBytes = 0
	}
	id := resource.ID()
	if err = queries.CreateKbDocument(ctx, sqlc.CreateKbDocumentParams{
		ID:              id,
		KbID:            input.KbID,
		Title:           input.Title,
		SourceType:      input.SourceType,
		Content:         input.Content,
		FileName:        optionalString(input.FileName),
		MimeType:        optionalString(input.MimeType),
		SizeBytes:       input.SizeBytes,
		Status:          status,
		CreatedByUserID: actor,
		ParentID:        parentID,
		NodeType:        nodeType,
		Position:        position,
	}); err != nil {
		return nil, err
	}
	if nodeType == "folder" {
		if err = recordContentChange(ctx, tx, actor, input.KbID, id, "create"); err != nil {
			return nil, err
		}
		if err = tx.Commit(ctx); err != nil {
			return nil, err
		}
		return s.GetDocument(ctx, id)
	}
	revision, err := queries.GetKbDocumentRevision(ctx, id)
	if err != nil {
		return nil, err
	}
	targetModel, targetDimension := embeddingBindingTarget(binding.EmbeddingModelID, binding.EmbeddingDimension)
	if err = createKbDocumentJob(ctx, queries, input.KbID, id, OperationLearn, revision, targetModel, targetDimension); err != nil {
		return nil, err
	}
	if err = recordContentChange(ctx, tx, actor, input.KbID, id, "create"); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetDocument(ctx, id)
}

// lockDocument serializes document writes with KB deletion and index maintenance.
// Always acquire locks in KB -> document -> learning job order.
func lockDocument(ctx context.Context, queries *sqlc.Queries, id string) (resource.Object, error) {
	item, err := resource.DecodeObject(queries.GetKbDocument(ctx, id))
	if err != nil {
		return nil, err
	}
	if _, err = queries.LockKbResource(ctx, item.String("kb_id")); err != nil {
		return nil, err
	}
	return resource.DecodeObject(queries.LockKbDocument(ctx, id))
}

func (s *Service) UpdateDocument(ctx context.Context, id string, input DocumentInput) (resource.Object, error) {
	return s.updateDocument(ctx, id, input, "")
}
func (s *Service) updateDocument(ctx context.Context, id string, input DocumentInput, actor string) (resource.Object, error) {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx, id)
	queries := sqlc.New(tx)
	current, err := lockDocument(ctx, queries, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, resource.NotFound
		}
		return nil, err
	}
	if err = requireContentWrite(ctx, tx, current.String("kb_id"), actor); err != nil {
		return nil, err
	}
	if err = requireDocumentVersion(ctx, tx, current, actor, input.ExpectedRevision); err != nil {
		return nil, err
	}
	if input.KbID != "" && strings.TrimSpace(input.KbID) != current.String("kb_id") {
		return nil, resource.NotFound
	}
	if current.String("node_type") == "folder" {
		title := strings.TrimSpace(input.Title)
		if title == "" {
			title = current.String("title")
		}
		if err = queries.UpdateKbDocumentMetadata(ctx, sqlc.UpdateKbDocumentMetadataParams{
			ID:         id,
			Title:      title,
			SourceType: "text",
			SizeBytes:  0,
		}); err != nil {
			return nil, err
		}
		if err = bumpDocumentVersion(ctx, tx, current); err != nil {
			return nil, err
		}
		if err = recordContentChange(ctx, tx, actor, current.String("kb_id"), id, "update"); err != nil {
			return nil, err
		}
		if err = tx.Commit(ctx); err != nil {
			return nil, err
		}
		return s.GetDocument(ctx, id)
	}
	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = current.String("title")
	}
	sourceType := strings.TrimSpace(input.SourceType)
	if sourceType == "" {
		sourceType = current.String("source_type")
	}
	if sourceType != "text" && sourceType != "file" && sourceType != "url" {
		return nil, resource.Invalid("文档来源类型无效")
	}
	if current.String("source_type") == "file" && sourceType != "file" {
		return nil, resource.Invalid("文件文档不支持改为文本文档，请重新上传文件")
	}
	content := input.Content
	if strings.TrimSpace(content) == "" {
		content = current.String("content")
	}
	size := input.SizeBytes
	if size <= 0 {
		if sourceType == "file" {
			size = objectInt64(current["size_bytes"])
		}
		if size <= 0 {
			size = int64(len(content))
		}
	}
	fileName := strings.TrimSpace(input.FileName)
	if fileName == "" {
		fileName = current.String("file_name")
	}
	mimeType := strings.TrimSpace(input.MimeType)
	if mimeType == "" {
		mimeType = current.String("mime_type")
	}
	contentChanged := content != current.String("content")
	if contentChanged {
		if err = queries.UpdateKbDocument(ctx, sqlc.UpdateKbDocumentParams{
			ID:         id,
			Title:      title,
			SourceType: sourceType,
			Content:    content,
			FileName:   optionalString(fileName),
			MimeType:   optionalString(mimeType),
			SizeBytes:  size,
		}); err != nil {
			return nil, err
		}
		if err = queries.CancelKbLearningJobsByDocument(ctx, &id); err != nil {
			return nil, err
		}
		if err = queries.DeleteKbChunksByDocument(ctx, id); err != nil {
			return nil, err
		}
		revision, err := queries.GetKbDocumentRevision(ctx, id)
		if err != nil {
			return nil, err
		}
		binding, err := queries.GetKbEmbedding(ctx, current.String("kb_id"))
		if err != nil {
			return nil, err
		}
		targetModel, targetDimension := embeddingBindingTarget(binding.EmbeddingModelID, binding.EmbeddingDimension)
		if err = createKbDocumentJob(ctx, queries, current.String("kb_id"), id, OperationRelearn, revision, targetModel, targetDimension); err != nil {
			return nil, err
		}
	} else if err = queries.UpdateKbDocumentMetadata(ctx, sqlc.UpdateKbDocumentMetadataParams{
		ID:         id,
		Title:      title,
		SourceType: sourceType,
		FileName:   optionalString(fileName),
		MimeType:   optionalString(mimeType),
		SizeBytes:  size,
	}); err != nil {
		return nil, err
	}
	if err = bumpDocumentVersion(ctx, tx, current); err != nil {
		return nil, err
	}
	if err = recordContentChange(ctx, tx, actor, current.String("kb_id"), id, "update"); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetDocument(ctx, id)
}

func (s *Service) DeleteDocument(ctx context.Context, id string) error {
	return s.deleteDocument(ctx, id, "", 0)
}
func (s *Service) deleteDocument(ctx context.Context, id, actor string, expected int64) error {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx, id)
	queries := sqlc.New(tx)
	current, err := lockDocument(ctx, queries, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return resource.NotFound
		}
		return err
	}
	if err = requireContentWrite(ctx, tx, current.String("kb_id"), actor); err != nil {
		return err
	}
	if err = requireDocumentVersion(ctx, tx, current, actor, expected); err != nil {
		return err
	}
	children, err := queries.CountKbDocumentChildren(ctx, &id)
	if err != nil {
		return err
	}
	if children > 0 {
		return resource.Invalid("请先移走或删除文件夹中的内容")
	}
	if err = queries.CancelKbLearningJobsByDocument(ctx, &id); err != nil {
		return err
	}
	if err = queries.DeleteKbChunksByDocument(ctx, id); err != nil {
		return err
	}
	deleted, err := queries.SoftDeleteKbDocument(ctx, id)
	if err != nil {
		return err
	}
	if deleted == 0 {
		return resource.NotFound
	}
	if err = recordContentChange(ctx, tx, actor, current.String("kb_id"), id, "delete"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) RestudyDocument(ctx context.Context, id string) (resource.Object, error) {
	return s.restudyDocument(ctx, id, "")
}
func (s *Service) restudyDocument(ctx context.Context, id, actor string) (resource.Object, error) {
	tx, err := s.store.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx, id)
	queries := sqlc.New(tx)
	document, err := lockDocument(ctx, queries, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, resource.NotFound
		}
		return nil, err
	}
	if err = requireContentWrite(ctx, tx, document.String("kb_id"), actor); err != nil {
		return nil, err
	}
	if document.String("node_type") == "folder" {
		return nil, resource.Invalid("文件夹不能执行学习任务")
	}
	if err = queries.CancelKbLearningJobsByDocument(ctx, &id); err != nil {
		return nil, err
	}
	binding, err := queries.GetKbEmbedding(ctx, document.String("kb_id"))
	if err != nil {
		return nil, err
	}
	modelID, dimension := embeddingBindingTarget(binding.EmbeddingModelID, binding.EmbeddingDimension)
	if documentHasChunks(document) {
		if modelID == "" || dimension <= 0 {
			if err = queries.SetKbDocumentLexicallyLearned(ctx, id); err != nil {
				return nil, err
			}
		} else {
			revision, err := queries.SetKbDocumentVectorLearning(ctx, id)
			if err != nil {
				return nil, err
			}
			if err = createKbDocumentJob(ctx, queries, document.String("kb_id"), id, OperationRebuildVector, revision, modelID, dimension); err != nil {
				return nil, err
			}
		}
	} else {
		revision, err := queries.SetKbDocumentPending(ctx, id)
		if err != nil {
			return nil, err
		}
		if err = createKbDocumentJob(ctx, queries, document.String("kb_id"), id, OperationRelearn, revision, modelID, dimension); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetDocument(ctx, id)
}

func (s *Service) SearchLearnedWithResponse(ctx context.Context, userID string, input SearchInput) (SearchResponse, error) {
	accessible, err := s.ListAccessible(ctx, userID)
	if err != nil {
		return SearchResponse{}, err
	}
	normalized, err := normalizeSearchInput(input)
	if err != nil {
		return SearchResponse{}, err
	}
	accessibleIDs := make(map[string]struct{}, len(accessible))
	for _, item := range accessible {
		accessibleIDs[item.String("id")] = struct{}{}
	}
	for _, id := range normalized.KbIDs {
		if _, ok := accessibleIDs[id]; !ok {
			return SearchResponse{}, resource.NotFound
		}
	}
	ids := learnedKBIDs(accessible)
	if len(ids) == 0 {
		return emptySearchResponse(normalized), nil
	}
	if len(normalized.KbIDs) > 0 {
		allowed := map[string]bool{}
		for _, id := range ids {
			allowed[id] = true
		}
		for _, id := range normalized.KbIDs {
			if !allowed[id] {
				return SearchResponse{}, resource.NotFound
			}
		}
	} else {
		normalized.KbIDs = ids
	}
	return s.searchWithPermissionRecheck(ctx, userID, accessible, normalized)
}

func (s *Service) SearchWithResponse(ctx context.Context, userID string, input SearchInput) (SearchResponse, error) {
	accessible, err := s.ListAccessible(ctx, userID)
	if err != nil {
		return SearchResponse{}, err
	}
	return s.searchWithPermissionRecheck(ctx, userID, accessible, input)
}

func normalizeSearchInput(input SearchInput) (SearchInput, error) {
	query := strings.TrimSpace(input.Query)
	if query == "" {
		return SearchInput{}, resource.Invalid("检索问题不能为空")
	}
	if utf8.RuneCountInString(query) > 4000 {
		return SearchInput{}, resource.Invalid("检索问题不能超过 4000 个字符")
	}
	topK := input.TopK
	if topK <= 0 {
		topK = defaultSearchResultSize
	}
	if topK > 20 {
		return SearchInput{}, resource.Invalid("top_k 必须在 1—20 之间")
	}
	input.Query = query
	input.TopK = topK
	return input, nil
}

func learnedKBIDs(items []resource.Object) []string {
	ids := make([]string, 0, len(items))
	for _, item := range items {
		id := item.String("id")
		if id == "" || objectInt64(item["learned_count"]) <= 0 {
			continue
		}
		ids = append(ids, id)
	}
	return ids
}

func objectInt64(value any) int64 {
	switch v := value.(type) {
	case int:
		return int64(v)
	case int32:
		return int64(v)
	case int64:
		return v
	case uint:
		return int64(v)
	case uint32:
		return int64(v)
	case uint64:
		if v > uint64(^uint64(0)>>1) {
			return 0
		}
		return int64(v)
	case float32:
		return int64(v)
	case float64:
		return int64(v)
	default:
		return 0
	}
}

func floatValue(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int64:
		return float64(v)
	case int:
		return float64(v)
	default:
		return 0
	}
}

// RestudyDocuments reports per-document failures without retrying successful items.
func (s *Service) RestudyDocuments(ctx context.Context, kbID string, ids []string) (BatchDocumentResult, error) {
	ids, err := normalizeBatchIDs(ids)
	if err != nil {
		return BatchDocumentResult{}, err
	}
	result := BatchDocumentResult{Succeeded: []string{}, Failed: []BatchDocumentFailure{}}
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		_, err := s.documentInKB(ctx, kbID, id)
		if err == nil {
			_, err = s.RestudyDocument(ctx, id)
		}
		if err != nil {
			result.Failed = append(result.Failed, BatchDocumentFailure{ID: id, Reason: err.Error()})
			continue
		}
		result.Succeeded = append(result.Succeeded, id)
	}
	return result, nil
}
