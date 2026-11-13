package kb

import "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

func mcpCreateKnowledgeBaseInput(arguments map[string]any) (resource.Object, error) {
	for key := range arguments {
		if key != "name" && key != "description" {
			return nil, resource.Invalid("不支持的知识库创建参数: " + key)
		}
	}
	name, err := mcpRequiredString(arguments, "name")
	if err != nil {
		return nil, err
	}
	if len(name) > 200 {
		return nil, resource.Invalid("名称不能超过 200 字节")
	}
	input := resource.Object{"name": name}
	if raw, exists := arguments["description"]; exists {
		description, ok := raw.(string)
		if !ok {
			return nil, resource.Invalid("description 必须为字符串")
		}
		input["description"] = description
	}
	return input, nil
}
