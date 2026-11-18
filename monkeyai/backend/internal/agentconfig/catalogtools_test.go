package agentconfig

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func assertEmptyCatalogTools(t testing.TB, item resource.Object) {
	t.Helper()
	// 独立认证连接的工具字段位于每份凭证下。
	if item.String("authorization_mode") == "independent" {
		return
	}
	switch tools := item["tools"].(type) {
	case []resource.Object:
		if tools == nil || len(tools) != 0 {
			t.Fatalf("连接列表应返回空工具数组: %v", item)
		}
	case []any:
		if tools == nil || len(tools) != 0 {
			t.Fatalf("连接列表应返回空工具数组: %v", item)
		}
	default:
		t.Fatalf("连接列表应保留 tools 空数组: %v", item)
	}
	if item.String("tools_version") != resource.Hash([]resource.Object{}) {
		t.Fatalf("连接列表应返回空工具数组的版本: %v", item)
	}
}
