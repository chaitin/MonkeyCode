package mcp

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestEnabledToolCount(t *testing.T) {
	f := setup(t)
	remote := mcpRemote(t, nil)
	c := f.call("POST", "/admin/connectors", resource.Object{
		"name": "enabled-tool-count", "url": remote.URL,
		"authorization_mode": "centralized", "authorization_method": "http_header",
		"credential": resource.Object{"name": "team", "http_headers": resource.Object{"Authorization": "header-secret"}},
	}, "owner", "", 200)
	cred := centralCredential(c)
	path := "/admin/connectors/" + c.String("id")
	check := func(want, total int64) resource.Object {
		t.Helper()
		got := f.call("GET", path, nil, "owner", "", 200)
		if got.Int("enabled_tool_count") != want || got.Int("tool_count") != total {
			t.Fatalf("enabled count=%d, total=%d; want enabled=%d, total=%d", got.Int("enabled_tool_count"), got.Int("tool_count"), want, total)
		}
		return got
	}
	check(1, 1)
	tools := f.call("GET", path+"/tools", nil, "owner", "", 200)["items"].([]any)
	tool := tools[0].(map[string]any)
	f.call("PATCH", path+"/tools/"+tool["id"].(string), resource.Object{"enabled": false, "credits_per_call": 0}, "owner", "", 200)
	check(0, 1)
	f.call("PATCH", path+"/tools/"+tool["id"].(string), resource.Object{"enabled": true, "credits_per_call": 0}, "owner", "", 200)
	check(1, 1)
	f.sql(`INSERT INTO mcp_tools(connector_id,credential_id,name,config_revision,enabled,deleted_at) VALUES($1,$2,'deleted',$3,true,now()),($1,$2,'old-config',0,true,NULL),($1,$2,'disabled',$3,false,NULL)`, c.String("id"), cred.String("id"), c.Int("config_revision"))
	check(1, 2)
	f.sql(`UPDATE connector_credentials SET config_revision=0 WHERE id=$1`, cred.String("id"))
	check(0, 0)
	f.sql(`UPDATE connector_credentials SET config_revision=$2,revoked_at=now() WHERE id=$1`, cred.String("id"), c.Int("config_revision"))
	check(0, 0)
	for _, mode := range []string{"none", "independent"} {
		other := f.call("POST", "/admin/connectors", resource.Object{"name": mode, "url": remote.URL, "authorization_mode": mode, "authorization_method": "http_header"}, "owner", "", 200)
		if other.Int("enabled_tool_count") != 0 {
			t.Fatal("noncentralized connector unexpectedly counted shared tools")
		}
	}
}
