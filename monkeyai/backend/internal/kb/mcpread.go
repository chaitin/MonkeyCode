package kb

import (
	"context"
	"encoding/base64"
	"encoding/json"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func (s *Service) readMCPKnowledgeBase(ctx context.Context, actor, tool string, arguments map[string]any) (resource.Object, error) {
	if tool == "kb_list_tags" {
		if len(arguments) != 0 {
			return nil, resource.Invalid("标签列表不接受参数")
		}
		items, err := s.listAccessible(ctx, actor, resource.CatalogFilter{})
		if err != nil {
			return nil, err
		}
		out := make([]resource.Object, 0, len(items))
		for _, item := range items {
			out = append(out, publicKB(item))
		}
		return resource.Object{"tags": resource.CollectTags(out)}, nil
	}
	var input struct {
		KbID string `json:"kb_id"`
	}
	if tool == "kb_list_chunks" {
		var document struct {
			KbID       string `json:"kb_id"`
			DocumentID string `json:"document_id"`
		}
		if err := decodeMCPArguments(arguments, &document); err != nil {
			return nil, err
		}
		if document.KbID == "" || document.DocumentID == "" {
			return nil, resource.Invalid("kb_id 和 document_id 必填")
		}
		if _, err := s.GetAccessibleDocumentInKB(ctx, actor, document.KbID, document.DocumentID); err != nil {
			return nil, err
		}
		items, err := s.ListChunks(ctx, document.DocumentID)
		if err != nil {
			return nil, err
		}
		// Retrieval may outlive a permission change; check again before returning content.
		if _, err := s.GetAccessibleDocumentInKB(ctx, actor, document.KbID, document.DocumentID); err != nil {
			return nil, err
		}
		return resource.Object{"items": items}, nil
	}
	if err := decodeMCPArguments(arguments, &input); err != nil {
		return nil, err
	}
	if input.KbID == "" {
		return nil, resource.Invalid("kb_id 不能为空")
	}
	if tool == "kb_list_permissions" {
		item, err := s.ownedUserKB(ctx, actor, input.KbID)
		if err != nil {
			return nil, err
		}
		return resource.Object{"grants": item["grants"], "revision": item["revision"]}, nil
	}
	item, err := s.GetAccessible(ctx, input.KbID, actor)
	if err != nil {
		return nil, err
	}
	return publicKBDetail(item, actor), nil
}

func (s *Service) readMCPImage(ctx context.Context, actor string, arguments map[string]any) (resource.Object, error) {
	var input struct {
		KbID string `json:"kb_id"`
		Name string `json:"name"`
	}
	if err := decodeMCPArguments(arguments, &input); err != nil {
		return nil, err
	}
	if input.KbID == "" || !assetName.MatchString(input.Name) {
		return nil, resource.Invalid("kb_id 必填，图片名称必须为上传接口返回的 name")
	}
	if s.storage == nil {
		return nil, resource.NotFound
	}
	book, err := s.GetAccessible(ctx, input.KbID, actor)
	if err != nil {
		return nil, err
	}
	data, mime, err := s.readAsset(ctx, book.String("id"), input.Name)
	if err != nil {
		return nil, err
	}
	if _, err := s.GetAccessible(ctx, book.String("id"), actor); err != nil {
		return nil, err
	}
	metadata := resource.Object{
		"kb_id": book.String("id"), "name": input.Name,
		"url": assetURL(book.String("id"), input.Name), "mime_type": mime, "size_bytes": len(data),
	}
	text, err := json.Marshal(metadata)
	if err != nil {
		return nil, err
	}
	return resource.Object{
		"content": []any{
			resource.Object{"type": "text", "text": string(text)},
			resource.Object{"type": "image", "data": base64.StdEncoding.EncodeToString(data), "mimeType": mime},
		},
		"structuredContent": metadata,
	}, nil
}
