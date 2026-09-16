package endpoint

import (
	"os"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestEndpointContract(t *testing.T) {
	data, err := os.ReadFile("../../api/agent.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err = yaml.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	paths := document["paths"].(map[string]any)
	for path, methods := range map[string][]string{
		"/api/v1/endpoints":                      {"get"},
		"/api/v1/endpoints/connect":              {"get"},
		"/api/v1/endpoints/{machine_id}":         {"get", "patch"},
		"/api/v1/endpoints/{machine_id}/revoke":  {"post"},
		"/api/v1/endpoints/{machine_id}/restore": {"post"},
	} {
		item, ok := paths[path].(map[string]any)
		if !ok {
			t.Fatalf("缺少路径 %s", path)
		}
		for _, method := range methods {
			if _, ok := item[method]; !ok {
				t.Fatalf("缺少 %s %s", method, path)
			}
		}
		var check func(any)
		check = func(value any) {
			switch v := value.(type) {
			case map[string]any:
				if ref, ok := v["$ref"].(string); ok && strings.HasPrefix(ref, "#/") {
					var target any = document
					for _, key := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
						node, ok := target.(map[string]any)
						if !ok {
							t.Fatalf("无效引用 %s", ref)
						}
						target, ok = node[key]
						if !ok {
							t.Fatalf("引用不存在 %s", ref)
						}
					}
				}
				for _, child := range v {
					check(child)
				}
			case []any:
				for _, child := range v {
					check(child)
				}
			}
		}
		check(item)
	}
}
