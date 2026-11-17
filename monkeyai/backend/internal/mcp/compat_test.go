package mcp

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestLegacyToolSettings(t *testing.T) {
	for _, mode := range []string{"none", "centralized", "independent"} {
		t.Run(mode, func(t *testing.T) {
			f := setup(t)
			remote := mcpRemote(t, nil)
			input := resource.Object{"name": "兼容工具", "url": remote.URL, "authorization_mode": mode, "grants": []resource.Object{{"user_id": f.users["owner"]}}}
			if mode != "none" {
				input["authorization_method"] = "http_header"
			}
			if mode == "centralized" {
				input["credential"] = resource.Object{"name": "集中凭证", "http_headers": resource.Object{"X-Account": "A"}}
			}
			c := f.call("POST", "/admin/connectors", input, "owner", "", 200)
			agent := "/agent/connectors/" + c.String("id")
			admin := "/admin/connectors/" + c.String("id")
			var credential resource.Object
			if mode == "centralized" {
				credential = centralCredential(c)
			} else if mode == "independent" {
				credential = f.call("POST", agent+"/credentials", resource.Object{"name": "独立凭证", "http_headers": resource.Object{"X-Account": "A"}}, "owner", "", 201)
			}
			toolsPath, adminTools := agent+"/tools", admin+"/tools"
			var credentialID any
			if credential != nil {
				credentialID = credential.String("id")
				toolsPath = agent + "/credentials/" + credential.String("id") + "/tools"
				adminTools = admin + "/credentials/" + credential.String("id") + "/tools"
			}
			id := resource.ID()
			f.sql("INSERT INTO mcp_tools(id,connector_id,credential_id,name,description,input_schema,enabled,credits_per_call,config_revision) VALUES($1,$2,$3,'same_tool','过期描述','{}',false,0,1)", id, c.String("id"), credentialID)
			if len(f.call("GET", toolsPath, nil, "owner", "", 200)["items"].([]any)) != 0 {
				t.Fatal("历史禁用配置未生效")
			}
			items := f.call("GET", adminTools, nil, "owner", "", 200)["items"].([]any)
			view := resource.Object(items[0].(map[string]any))
			if view.String("id") != id || view.String("description") == "过期描述" || view.Bool("enabled") || view["input_schema"] == nil {
				t.Fatalf("历史 ID、开关或实时定义不兼容: %v", view)
			}
			f.call("PATCH", admin+"/tools/"+id, resource.Object{"enabled": true, "credits_per_call": 0}, "owner", "", 200)
			visible := f.call("GET", toolsPath, nil, "owner", "", 200)["items"].([]any)
			if len(visible) != 1 || visible[0].(map[string]any)["id"] != id {
				t.Fatal("旧版 PATCH 请求未恢复历史工具")
			}
			other := f.call("POST", "/admin/connectors", resource.Object{"name": "另一连接", "url": remote.URL, "authorization_mode": "none"}, "owner", "", 200)
			f.call("PATCH", "/admin/connectors/"+other.String("id")+"/tools/"+id, resource.Object{"enabled": false, "credits_per_call": 0}, "owner", "", 404)
		})
	}
}

func TestLegacyPatchDiscoveredTool(t *testing.T) {
	for _, mode := range []string{"none", "centralized"} {
		t.Run(mode, func(t *testing.T) {
			f := setup(t)
			remote := mcpRemote(t, nil)
			input := resource.Object{"name": "无工具记录", "url": remote.URL, "authorization_mode": mode}
			if mode == "centralized" {
				input["authorization_method"] = "http_header"
				input["credential"] = resource.Object{"name": "集中凭证", "http_headers": resource.Object{"X-Account": "A"}}
			}
			c := f.call("POST", "/admin/connectors", input, "owner", "", 200)
			path := "/admin/connectors/" + c.String("id")
			items := f.call("GET", path+"/tools", nil, "owner", "", 200)["items"].([]any)
			id := items[0].(map[string]any)["id"].(string)
			f.call("PATCH", path+"/tools/"+id, resource.Object{"enabled": false, "credits_per_call": 0}, "owner", "", 200)
			var name string
			if err := f.pool.QueryRow(t.Context(), "SELECT name FROM mcp_tools WHERE id=$1", id).Scan(&name); err != nil || name != "same_tool" {
				t.Fatalf("旧客户端未提交 name 时不能保存实时工具: %q %v", name, err)
			}
		})
	}
}
