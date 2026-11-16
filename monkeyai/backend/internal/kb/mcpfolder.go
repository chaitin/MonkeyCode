package kb

import "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

func mcpFolderInput(arguments map[string]any) (DocumentInput, error) {
	var input struct {
		KbID     string  `json:"kb_id"`
		Title    string  `json:"title"`
		ParentID *string `json:"parent_id"`
	}
	if err := decodeMCPArguments(arguments, &input); err != nil {
		return DocumentInput{}, err
	}
	kbID, err := mcpRequiredString(arguments, "kb_id")
	if err != nil {
		return DocumentInput{}, err
	}
	title, err := mcpRequiredString(arguments, "title")
	if err != nil {
		return DocumentInput{}, err
	}
	parentID, err := normalizeParentID(input.ParentID)
	if err != nil {
		return DocumentInput{}, err
	}
	return DocumentInput{KbID: kbID, Title: title, ParentID: parentID, NodeType: "folder"}, nil
}

func mcpCreateParentSchema() resource.Object {
	return resource.Object{
		"type":        []string{"string", "null"},
		"description": "同一知识库内的父文件夹 ID；省略、null 或空字符串表示根目录，可使用 kb_create_folder 返回的 id",
	}
}

func mcpCreateDocumentProperties() resource.Object {
	properties := mcpDocumentProperties(true)
	properties["parent_id"] = mcpCreateParentSchema()
	return properties
}
