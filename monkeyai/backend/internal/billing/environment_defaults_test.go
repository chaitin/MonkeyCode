package billing

import (
	"encoding/json"
	"testing"
)

func TestLegacyEnvironmentBillingCannotBeDisabled(t *testing.T) {
	got := defaultPolicy()
	if err := json.Unmarshal([]byte(`{"enabled":false,"environment":{"enabled":false,"cpu_credits_per_core_hour":"123","memory_credits_per_gib_hour":"45"}}`), &got); err != nil {
		t.Fatal(err)
	}
	if got.Environment.CPU != amountText("123") || got.Environment.Memory != amountText("45") {
		t.Fatalf("旧开关不应关闭计费或覆盖自定义单价: %+v", got.Environment)
	}
}

func TestEnvironmentDefaultPricing(t *testing.T) {
	p := defaultPolicy()
	if p.Environment.CPU != amountText("100") || p.Environment.Memory != amountText("50") {
		t.Fatalf("云电脑默认单价不正确: %+v", p.Environment)
	}
}

func TestLegacyPolicyWithoutEnvironmentUsesDefaultPricing(t *testing.T) {
	p := defaultPolicy()
	if err := json.Unmarshal([]byte(`{"enabled":true,"charging_mode":"local"}`), &p); err != nil {
		t.Fatal(err)
	}
	if p.Environment.CPU != amountText("100") || p.Environment.Memory != amountText("50") {
		t.Fatalf("旧计费策略没有补充云电脑默认单价: %+v", p.Environment)
	}
}
