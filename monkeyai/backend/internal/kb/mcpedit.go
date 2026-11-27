package kb

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

const maxMCPEdits = 50
const maxMCPEditBytes = 256 << 10

type textEdit struct {
	OldText string `json:"old_text"`
	NewText string `json:"new_text"`
}

// Require both fields: an omitted new_text must not accidentally delete content.
func (e *textEdit) UnmarshalJSON(data []byte) error {
	var fields map[string]any
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if len(fields) != 2 {
		return resource.Invalid("每项编辑必须且只能包含 old_text 和 new_text")
	}
	old, okOld := fields["old_text"].(string)
	next, okNew := fields["new_text"].(string)
	if !okOld || !okNew {
		return resource.Invalid("old_text 和 new_text 必须为字符串")
	}
	e.OldText, e.NewText = old, next
	return nil
}

// Apply against the locked document, never a snapshot read before the transaction.
func applyTextEdits(content string, edits []textEdit) (string, error) {
	if len(edits) == 0 || len(edits) > maxMCPEdits {
		return "", resource.Invalid("edits 必须包含 1 到 50 项")
	}
	size := 0
	for i, edit := range edits {
		if edit.OldText == "" {
			return "", resource.Invalid(fmt.Sprintf("edits[%d].old_text 不能为空", i))
		}
		size += len(edit.OldText) + len(edit.NewText)
		if size > maxMCPEditBytes {
			return "", resource.Invalid(fmt.Sprintf("edits[%d] 处编辑文本合计超过 256 KiB", i))
		}
		count := countOverlapping(content, edit.OldText)
		if count != 1 {
			code := "text_not_found"
			if count > 1 {
				code = "ambiguous_match"
			}
			return "", resource.InvalidCode(code, fmt.Sprintf("edits[%d] 匹配 %d 次，要求唯一匹配；整批未写入", i, count))
		}
		content = strings.Replace(content, edit.OldText, edit.NewText, 1)
	}
	return content, nil
}

// countOverlapping counts every match position, including overlapping ones.
// Advancing one byte is safe: a valid UTF-8 needle never matches mid-rune.
func countOverlapping(content, needle string) int {
	count := 0
	for start := 0; start <= len(content); {
		index := strings.Index(content[start:], needle)
		if index < 0 {
			break
		}
		count++
		start += index + 1
	}
	return count
}

func (s *Service) editMCPDocument(ctx context.Context, actor string, arguments map[string]any) (resource.Object, error) {
	var input struct {
		KbID             string     `json:"kb_id"`
		DocumentID       string     `json:"document_id"`
		ExpectedRevision int64      `json:"expected_revision"`
		Edits            []textEdit `json:"edits"`
	}
	if err := decodeMCPArguments(arguments, &input); err != nil {
		return nil, err
	}
	if strings.TrimSpace(input.KbID) == "" || strings.TrimSpace(input.DocumentID) == "" {
		return nil, resource.Invalid("kb_id 和 document_id 必填")
	}
	if input.ExpectedRevision <= 0 {
		return nil, &resource.Error{Status: 428, Code: "precondition_required", Message: "请先读取文档并提供 expected_revision"}
	}
	if len(input.Edits) == 0 || len(input.Edits) > maxMCPEdits {
		return nil, resource.Invalid("edits 必须包含 1 到 50 项")
	}
	item, err := s.UpdateUserDocument(ctx, actor, input.DocumentID, DocumentInput{KbID: input.KbID, ExpectedRevision: input.ExpectedRevision, edits: input.Edits})
	if err != nil {
		return nil, err
	}
	return s.agentDocumentSummary(item), nil
}
