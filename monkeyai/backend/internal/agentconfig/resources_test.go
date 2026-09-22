package agentconfig

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

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
