package mcp

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestConnectorDoesNotReportCachedToolCounts(t *testing.T) {
	f := setup(t)
	remote := mcpRemote(t, nil)
	for _, mode := range []string{"none", "centralized", "independent"} {
		input := resource.Object{"name": mode, "url": remote.URL, "authorization_mode": mode, "authorization_method": "http_header"}
		if mode == "centralized" {
			input["credential"] = resource.Object{"name": "集中凭证", "http_headers": resource.Object{"Authorization": "header-secret"}}
		}
		c := f.call("POST", "/admin/connectors", input, "owner", "", 200)
		got := f.call("GET", "/admin/connectors/"+c.String("id"), nil, "owner", "", 200)
		for _, key := range []string{"tool_count", "enabled_tool_count"} {
			if _, ok := got[key]; ok {
				t.Fatalf("不应将本地配置数量作为实时工具数量: %v", got)
			}
		}
	}
}
