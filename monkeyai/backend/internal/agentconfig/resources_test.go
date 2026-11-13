package agentconfig

import (
	"context"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestSharedPersonalRuleAccess(t *testing.T) {
	rule := resource.Object{"id": "rule-id", "ownership_type": "user", "owner_user_id": "owner"}
	owner := catalog{grants: map[string]bool{}}
	if !owner.allowed("rule", rule, "owner") {
		t.Fatal("owner cannot use personal rule")
	}
	recipient := catalog{grants: map[string]bool{"rule:rule-id": true}}
	if !recipient.allowed("rule", rule, "recipient") {
		t.Fatal("shared recipient cannot use personal rule")
	}
	other := catalog{grants: map[string]bool{}}
	if other.allowed("rule", rule, "other") || other.allowed("rule", rule, "") {
		t.Fatal("personal rule accessible without sharing")
	}
}

func TestUniqueIDsPreservesSameNameResources(t *testing.T) {
	items := []resource.Object{
		{"id": "admin-id", "name": "同名", "origin": "local"},
		{"id": "package-id", "name": "同名", "origin": "package"},
		{"id": "admin-id", "name": "同名", "origin": "local"},
	}
	result := uniqueIDs(items)
	if len(result) != 2 || result[0].String("id") != "admin-id" || result[1].String("id") != "package-id" {
		t.Fatalf("应保留不同 ID 的同名资源: %v", result)
	}
}

func TestRuleDTORequirement(t *testing.T) {
	rule := resource.Object{"id": "rule-id", "name": "规则", "content": "正文"}
	for _, forced := range []bool{false, true} {
		out := ruleDTO(rule, forced)
		if out.Bool("required") != forced {
			t.Fatalf("forced=%v: rule metadata = %v", forced, out)
		}
		if _, ok := out["default_enabled"]; ok {
			t.Fatalf("forced=%v: rule metadata = %v", forced, out)
		}
	}
}

func TestKnowledgeBaseConnectorCatalog(t *testing.T) {
	r := &Resources{mcp: &mcp.Service{PublicURL: "https://example.com"}}
	connector := knowledgeBaseConnector("user-1")
	c := catalog{connectors: map[string]resource.Object{connector.String("id"): connector}, grants: map[string]bool{}}
	if !c.allowed("connector", connector, "user-1") {
		t.Fatal("built-in knowledge base connector must be available to its owner")
	}
	if c.allowed("connector", connector, "user-2") {
		t.Fatal("built-in knowledge base connector must not leak to other users")
	}

	dto, err := r.connectorDTO(context.Background(), nil, c, connector, "user-1")
	if err != nil {
		t.Fatalf("catalog built-in knowledge base connector: %v", err)
	}
	if dto.String("authorization_status") != "not_required" || dto.String("connection_status") != "connected" {
		t.Fatalf("unexpected authorization state: %v", dto)
	}
	capabilities, _ := dto["capabilities"].([]string)
	if len(capabilities) != 2 || capabilities[0] != "catalog" || capabilities[1] != "invoke" {
		t.Fatalf("unexpected capabilities: %v", dto["capabilities"])
	}
	gateway, _ := dto["mcp_gateway"].(resource.Object)
	if gateway.String("url") != "https://example.com/mcp/kb" || gateway.String("transport") != "streamable_http" || gateway.String("authentication") != "api_key" || gateway.String("required_scope") != "mcp:invoke" {
		t.Fatalf("unexpected gateway: %v", gateway)
	}
	tools, _ := dto["tools"].([]resource.Object)
	names := map[string]bool{}
	for _, tool := range tools {
		if tool["input_schema"] == nil {
			t.Fatalf("tool schema missing: %v", tool)
		}
		names[tool.String("name")] = true
	}
	for _, name := range []string{"kb_list", "kb_list_documents", "kb_get_document", "kb_create_document", "kb_update_document", "kb_delete_document", "kb_search"} {
		if !names[name] {
			t.Fatalf("tool %s missing from catalog: %v", name, names)
		}
	}
	if dto.String("tools_version") == "" {
		t.Fatal("tools_version must be set")
	}
}
