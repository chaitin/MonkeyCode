package kb

import (
	"context"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"strings"
)

const mcpTextPageDefault = 4000
const mcpTextPageMax = 16000

func textPage(content string, offset, limit int) (resource.Object, error) {
	if offset < 0 || limit < 1 || limit > mcpTextPageMax {
		return nil, resource.Invalid("offset 必须非负，limit 必须为 1 到 16000")
	}
	chars := []rune(content)
	if offset > len(chars) {
		return nil, resource.Invalid("offset 超出正文长度")
	}
	end := offset + min(limit, len(chars)-offset)
	var next any
	if end < len(chars) {
		next = end
	}
	return resource.Object{"content": string(chars[offset:end]), "offset": offset, "next_offset": next, "total_characters": len(chars), "has_more": end < len(chars)}, nil
}

func (s *Service) readMCPDocument(ctx context.Context, actor string, arguments map[string]any) (resource.Object, error) {
	input := struct {
		KbID             string `json:"kb_id"`
		DocumentID       string `json:"document_id"`
		ExpectedRevision int64  `json:"expected_revision"`
		Offset           int    `json:"offset"`
		Limit            int    `json:"limit"`
	}{Limit: mcpTextPageDefault}
	if err := decodeMCPArguments(arguments, &input); err != nil {
		return nil, err
	}
	if strings.TrimSpace(input.KbID) == "" || strings.TrimSpace(input.DocumentID) == "" || input.ExpectedRevision < 0 {
		return nil, resource.Invalid("kb_id、document_id 必填，版本不能为负数")
	}
	if input.Offset > 0 && input.ExpectedRevision == 0 {
		return nil, &resource.Error{Status: 428, Code: "precondition_required", Message: "继续读取须提供首页返回的 revision，避免拼接不同版本"}
	}
	item, err := s.GetAccessibleDocumentInKB(ctx, actor, input.KbID, input.DocumentID)
	if err != nil {
		return nil, err
	}
	if item.String("node_type") == "folder" {
		return nil, resource.Invalid("文件夹没有正文，不能读取")
	}
	if err := checkDocumentVersion(item, input.ExpectedRevision); err != nil {
		return nil, err
	}
	if !textFileType(item.String("file_type")) {
		return resource.Object{"content": "", "document": s.agentDocumentSummary(item), "url": s.originalDocumentURL(item)}, nil
	}
	page, err := textPage(item.String("content"), input.Offset, input.Limit)
	if err != nil {
		return nil, err
	}
	page["document"] = s.agentDocumentSummary(item)
	return page, nil
}
