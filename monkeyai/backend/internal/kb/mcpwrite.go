package kb

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

const mcpAvatarRequestLimit = (avatarUploadLimit+2)/3*4 + (1 << 20)

// Unlike tools/list, tools/call need not have passed through a schema validator.
func decodeMCPArguments(arguments map[string]any, target any) error {
	data, err := json.Marshal(arguments)
	if err != nil {
		return resource.Invalid("工具参数无效")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return resource.Invalid("工具参数无效")
	}
	return nil
}

type mcpKnowledgeBaseUpdate struct {
	KbID             string          `json:"kb_id"`
	ExpectedRevision int64           `json:"expected_revision"`
	Name             string          `json:"name"`
	Description      *string         `json:"description"`
	TagIDs           *[]string       `json:"tag_ids"`
	FusionConfig     json.RawMessage `json:"fusion_config"`
	AvatarBase64     *string         `json:"avatar_base64"`
}

func (s *Service) updateMCPKnowledgeBase(ctx context.Context, actor string, arguments map[string]any) (resource.Object, error) {
	var input mcpKnowledgeBaseUpdate
	if err := decodeMCPArguments(arguments, &input); err != nil {
		return nil, err
	}
	input.KbID, input.Name = strings.TrimSpace(input.KbID), strings.TrimSpace(input.Name)
	if input.KbID == "" || input.Name == "" || len(input.Name) > 200 {
		return nil, resource.Invalid("kb_id 和 name 必填，名称不能超过 200 字节")
	}
	if input.ExpectedRevision <= 0 {
		return nil, &resource.Error{Status: 428, Code: "precondition_required", Message: "请先读取知识库并提供 expected_revision"}
	}
	metadata := resource.Object{"name": input.Name}
	if input.Description != nil {
		metadata["description"] = *input.Description
	}
	if input.TagIDs != nil {
		metadata["tag_ids"] = *input.TagIDs
	}
	if input.FusionConfig != nil {
		var config map[string]any
		if err := json.Unmarshal(input.FusionConfig, &config); err != nil || config == nil {
			return nil, resource.Invalid("fusion_config 必须为对象")
		}
		metadata["fusion_config"] = config
	}
	var avatar *avatarChange
	if input.AvatarBase64 != nil {
		if len(*input.AvatarBase64) == 0 || len(*input.AvatarBase64) > (avatarUploadLimit+2)/3*4 {
			return nil, resource.Invalid("图标不能为空且不能超过 1 MiB")
		}
		data, err := base64.StdEncoding.Strict().DecodeString(*input.AvatarBase64)
		if err != nil {
			return nil, resource.Invalid("图标必须为标准 Base64 编码，不包含 data URL 前缀")
		}
		avatar, err = readAvatar(data)
		if err != nil {
			return nil, err
		}
	}
	item, err := s.saveAvatar(ctx, actor, input.KbID, fmt.Sprintf(`"%d"`, input.ExpectedRevision), metadata, avatar, true)
	if err != nil {
		return nil, err
	}
	return publicKBDetail(item, actor), nil
}

func (s *Service) writeMCPDocument(ctx context.Context, actor, tool string, arguments map[string]any) (resource.Object, error) {
	if _, ok := arguments["ids"]; ok {
		return s.writeMCPDocuments(ctx, actor, tool, arguments)
	}

	var input struct {
		KbID       string `json:"kb_id"`
		DocumentID string `json:"document_id"`
		MoveDocumentInput
	}
	if tool == "kb_restudy_document" {
		var restudy struct {
			KbID       string `json:"kb_id"`
			DocumentID string `json:"document_id"`
		}
		if err := decodeMCPArguments(arguments, &restudy); err != nil {
			return nil, err
		}
		input.KbID, input.DocumentID = restudy.KbID, restudy.DocumentID
	} else if err := decodeMCPArguments(arguments, &input); err != nil {
		return nil, err
	}
	input.KbID, input.DocumentID = strings.TrimSpace(input.KbID), strings.TrimSpace(input.DocumentID)
	if input.KbID == "" || input.DocumentID == "" || input.ExpectedRevision < 0 {
		return nil, resource.Invalid("kb_id、document_id 必填，文档版本不能为负数")
	}
	if _, err := s.GetAccessibleDocumentInKB(ctx, actor, input.KbID, input.DocumentID); err != nil {
		return nil, err
	}
	if tool == "kb_restudy_document" {
		return s.restudyDocument(ctx, input.DocumentID, actor)
	}
	return s.moveDocument(ctx, input.KbID, input.DocumentID, input.MoveDocumentInput, actor)
}

// Keep legacy document_id calls compatible while exposing ids on the same tools.
func (s *Service) writeMCPDocuments(ctx context.Context, actor, tool string, arguments map[string]any) (resource.Object, error) {
	var input struct {
		KbID string `json:"kb_id"`
		DocumentOperationInput
	}
	if err := decodeMCPArguments(arguments, &input); err != nil {
		return nil, err
	}
	if strings.TrimSpace(input.KbID) == "" {
		return nil, resource.Invalid("kb_id 必填")
	}
	var result BatchDocumentResult
	var err error
	switch tool {
	case "kb_restudy_document":
		if input.ParentID != nil || input.PrevID != "" || input.NextID != "" || len(input.ExpectedRevisions) != 0 {
			return nil, resource.Invalid("重新学习只接受 kb_id 和 ids")
		}
		result, err = s.restudyDocuments(ctx, strings.TrimSpace(input.KbID), input.IDs, actor)
	case "kb_delete_document":
		result, err = s.operateDocuments(ctx, strings.TrimSpace(input.KbID), "delete", input.DocumentOperationInput, actor)
	default:
		result, err = s.operateDocuments(ctx, strings.TrimSpace(input.KbID), "move", input.DocumentOperationInput, actor)
	}
	if err != nil {
		return nil, err
	}
	return resource.Object{"succeeded": result.Succeeded, "failed": result.Failed}, nil
}

func mcpDocumentOperationSchema(properties resource.Object) resource.Object {
	properties["ids"] = resource.Object{"type": "array", "minItems": 1, "maxItems": maxBatchDocuments, "items": mcpIDSchema()}
	schema := mcpObjectSchema(properties, "kb_id")
	schema["oneOf"] = []any{
		resource.Object{"required": []string{"ids"}, "not": resource.Object{"required": []string{"document_id"}}},
		resource.Object{"required": []string{"document_id"}, "not": resource.Object{"required": []string{"ids"}}},
	}
	return schema
}
