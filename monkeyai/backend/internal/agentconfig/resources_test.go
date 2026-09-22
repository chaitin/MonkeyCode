package agentconfig

import (
	"testing"

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
