package billing

import (
	"encoding/json"
	"testing"
)

func TestLegacyEnvironmentBillingCannotBeDisabled(t *testing.T) {
	s, _, _ := fixture(t)
	p := defaultPolicy()
	p.Environment = ComputePricing{Enabled: false, CPU: amountText("123"), Memory: amountText("45")}
	setPolicy(t, s, p)
	got, err := s.Policy(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if !got.Environment.Enabled || got.Environment.CPU != p.Environment.CPU || got.Environment.Memory != p.Environment.Memory {
		t.Fatalf("旧开关不应关闭计费或覆盖自定义单价: %+v", got.Environment)
	}
}

func TestEnvironmentDefaultPricing(t *testing.T) {
	p := defaultPolicy()
	if !p.Environment.Enabled || p.Environment.CPU != amountText("100") || p.Environment.Memory != amountText("50") {
		t.Fatalf("云电脑默认单价不正确: %+v", p.Environment)
	}
}

func TestLegacyPolicyWithoutEnvironmentUsesDefaultPricing(t *testing.T) {
	p := defaultPolicy()
	if err := json.Unmarshal([]byte(`{"enabled":true,"charging_mode":"local"}`), &p); err != nil {
		t.Fatal(err)
	}
	if !p.Environment.Enabled || p.Environment.CPU != amountText("100") || p.Environment.Memory != amountText("50") {
		t.Fatalf("旧计费策略没有补充云电脑默认单价: %+v", p.Environment)
	}
}
