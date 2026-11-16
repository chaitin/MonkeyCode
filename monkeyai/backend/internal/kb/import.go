package kb

import (
	"context"
	"encoding/json"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
)

type ImportChange struct {
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Action    string `json:"action"`
	KbID      string `json:"kb_id,omitempty"`
	Documents int    `json:"documents"`
	Images    int    `json:"images"`
	Folders   int    `json:"folders"`
}
type ImportPlan struct {
	PublisherID string         `json:"publisher_id"`
	ReleaseID   string         `json:"release_id"`
	PlanDigest  string         `json:"plan_digest"`
	Changes     []ImportChange `json:"changes"`
}

func importConflict(message string) error {
	return &resource.Error{Status: 409, Code: "import_conflict", Message: message}
}
func (s *Service) PlanImport(_ context.Context, p *ImportPackage) (ImportPlan, error) {
	out := ImportPlan{PublisherID: p.Manifest.PublisherID, ReleaseID: p.Manifest.ReleaseID, Changes: []ImportChange{}}
	for _, book := range p.Books {
		change := ImportChange{Slug: book.Slug, Name: book.Metadata.Name, Action: "create", Images: len(book.Assets)}
		for _, node := range book.Nodes {
			if node.NodeType == "document" {
				change.Documents++
			} else {
				change.Folders++
			}
		}
		out.Changes = append(out.Changes, change)
	}
	out.PlanDigest = resource.Hash(resource.Object{"publisher": out.PublisherID, "release": out.ReleaseID, "source": p.SHA256, "changes": out.Changes})
	return out, nil
}

// ApplyImport creates an independent editable system KB for each import.
// The caller owns the transaction and persists its section receipt before commit.
func (s *Service) ApplyImport(ctx context.Context, tx pgx.Tx, p *ImportPackage, actor, expected string) (ImportPlan, error) {
	q := sqlc.New(tx)
	plan, err := s.PlanImport(ctx, p)
	if err != nil {
		return plan, err
	}
	if plan.PlanDigest != expected {
		return plan, importConflict("知识库预览已变化，请重新预览")
	}
	for i, book := range p.Books {
		id := resource.ID()
		data := resource.Object{"id": id, "actor_id": actor, "ownership_type": "system", "name": book.Metadata.Name, "description": book.Metadata.Description, "enabled": true}
		if err = s.validate(ctx, tx, data, resource.Object{}); err != nil {
			return plan, err
		}
		raw, e := json.Marshal(data)
		if e != nil {
			return plan, e
		}
		if err = q.CreateKbResource(ctx, raw); err != nil {
			return plan, err
		}
		tags := []string{}
		for _, name := range book.Metadata.Tags {
			tag, e := q.ResolveKbImportTag(ctx, sqlc.ResolveKbImportTagParams{Name: name, CreatedByUserID: actor})
			if e != nil {
				return plan, e
			}
			tags = append(tags, tag)
		}
		if err = resource.SaveTags(ctx, tx, "kb", id, actor, tags); err != nil {
			return plan, err
		}
		for _, asset := range book.Assets {
			if s.storage == nil {
				return plan, resource.Invalid("知识库图片存储尚未配置")
			}
			if err = s.storage.Put(ctx, assetObjectKey(id, asset.Name), asset.Data, asset.MIME); err != nil {
				return plan, err
			}

		}
		ids := map[string]string{}
		modelID := data.String("embedding_model_id")
		dimension := int(objectInt64(data["embedding_dimension"]))
		for _, node := range book.Nodes {
			documentID := resource.ID()
			var parentID *string
			if node.ParentKey != nil {
				parent := ids[*node.ParentKey]
				parentID = &parent
			}
			content, status := "", "learned"
			if node.NodeType == "document" {
				content, err = p.Content(node)
				if err != nil {
					return plan, err
				}
				content = book.RewriteAssets(content, id)
				status = "pending"
			}
			sourceType := node.SourceType
			if sourceType == "" {
				sourceType = "text"
			}
			if err = q.CreateKbDocument(ctx, sqlc.CreateKbDocumentParams{ID: documentID, KbID: id, Title: node.Title, SourceType: sourceType, Content: content, FileName: optionalString(node.FileName), MimeType: optionalString(node.MIMEType), SizeBytes: int64(len(content)), Status: status, CreatedByUserID: actor, ParentID: parentID, NodeType: node.NodeType, Position: float64(node.Order+1) * 1000}); err != nil {
				return plan, err
			}
			if err = recordContentChange(ctx, tx, actor, id, documentID, "create"); err != nil {
				return plan, err
			}
			ids[node.Key] = documentID
			if node.NodeType == "document" {
				if err = createKbDocumentJob(ctx, q, id, documentID, OperationLearn, 1, modelID, dimension); err != nil {
					return plan, err
				}
			}
		}
		if err = resource.Audit(ctx, tx, actor, "kb", id, "import"); err != nil {
			return plan, err
		}
		plan.Changes[i].KbID = id
	}
	return plan, nil
}
