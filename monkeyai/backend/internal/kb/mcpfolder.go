package kb

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
