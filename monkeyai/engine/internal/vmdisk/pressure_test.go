package vmdisk

import (
	"math"
	"testing"
)

func TestPressureHysteresis(t *testing.T) {
	policy := PressurePolicy{WarningBytes: 30, CriticalBytes: 10, RecoveryBytes: 50, WarningInodes: 30, CriticalInodes: 10, RecoveryInodes: 50}
	for _, tc := range []struct {
		name           string
		bytes, inodes  int64
		previous, want Pressure
	}{
		{"正常", 100, 100, "", PressureNormal},
		{"字节警戒边界", 30, 100, PressureNormal, PressureWarning},
		{"inode警戒边界", 100, 30, PressureNormal, PressureWarning},
		{"紧急边界", 10, 100, PressureWarning, PressureCritical},
		{"紧急保持", 49, 100, PressureCritical, PressureCritical},
		{"inode未恢复", 100, 49, PressureCritical, PressureCritical},
		{"警戒保持", 40, 100, PressureWarning, PressureWarning},
		{"完全恢复", 50, 50, PressureCritical, PressureNormal},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := policy.Evaluate(Capacity{TotalBytes: 100, AvailableBytes: tc.bytes, TotalInodes: 100, FreeInodes: tc.inodes}, tc.previous)
			if err != nil || got != tc.want {
				t.Fatalf("Evaluate() = %q, %v; want %q", got, err, tc.want)
			}
		})
	}
}

func TestPressureRejectsInvalidPolicyAndCapacity(t *testing.T) {
	policy := PressurePolicy{WarningBytes: 30, CriticalBytes: 10, RecoveryBytes: 50, WarningInodes: 30, CriticalInodes: 10, RecoveryInodes: 50}
	capacity := Capacity{TotalBytes: 100, AvailableBytes: 100, TotalInodes: 100, FreeInodes: 100}
	if _, err := (PressurePolicy{}).Evaluate(capacity, ""); err == nil {
		t.Fatal("零策略不能默认放行")
	}
	for _, c := range []Capacity{
		{},
		{TotalBytes: 100, AvailableBytes: -1, TotalInodes: 100, FreeInodes: 100},
		{TotalBytes: 100, AvailableBytes: 101, TotalInodes: 100, FreeInodes: 100},
		{TotalBytes: 100, AvailableBytes: 100, TotalInodes: 100, FreeInodes: 101},
	} {
		if _, err := policy.Evaluate(c, ""); err == nil {
			t.Fatalf("无效容量被接受: %+v", c)
		}
	}
	if _, err := policy.Evaluate(capacity, Pressure("unknown")); err == nil {
		t.Fatal("未知状态被接受")
	}
}

func TestPressureAdmission(t *testing.T) {
	policy := PressurePolicy{WarningBytes: 30, CriticalBytes: 10, RecoveryBytes: 50, WarningInodes: 30, CriticalInodes: 10, RecoveryInodes: 50}
	capacity := Capacity{TotalBytes: 100, AvailableBytes: 100, TotalInodes: 100, FreeInodes: 100}
	for _, tc := range []struct {
		name                string
		state               Pressure
		reserved, requested int64
		ok                  bool
	}{
		{"恰好保留水位", PressureNormal, 20, 50, true},
		{"越过水位", PressureNormal, 20, 51, false},
		{"负预留", PressureNormal, -1, 1, false},
		{"零请求", PressureNormal, 0, 0, false},
		{"溢出", PressureNormal, math.MaxInt64, math.MaxInt64, false},
		{"紧急状态已恢复", PressureCritical, 0, 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := policy.Admit(capacity, tc.state, tc.reserved, tc.requested)
			if (err == nil) != tc.ok {
				t.Fatalf("Admit() = %v, want ok=%t", err, tc.ok)
			}
		})
	}
	capacity.AvailableBytes = 40
	if err := policy.Admit(capacity, PressureCritical, 0, 1); err == nil {
		t.Fatal("紧急滞回期间不能放行")
	}
	capacity.AvailableBytes = 100
	capacity.FreeInodes = 30
	if err := policy.Admit(capacity, PressureNormal, 0, 1); err == nil {
		t.Fatal("inode警戒期间不能放行")
	}
}
