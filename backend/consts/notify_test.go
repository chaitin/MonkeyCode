package consts

import "testing"

func TestNotifyEventTypesForRegion(t *testing.T) {
	cnEvents := NotifyEventTypesForRegion("cn")
	if got := cnEvents[0].Name; got != "创建任务" {
		t.Fatalf("cn first event name = %q, want 创建任务", got)
	}
	if got := cnEvents[4].Name; got != "今日基础模型额度已耗尽" {
		t.Fatalf("cn quota event name = %q, want 今日基础模型额度已耗尽", got)
	}

	globalEvents := NotifyEventTypesForRegion("global")
	if got := globalEvents[0].Name; got != "Create task" {
		t.Fatalf("global first event name = %q, want Create task", got)
	}
	if got := globalEvents[4].Name; got != "Basic model quota exhausted today" {
		t.Fatalf("global quota event name = %q, want Basic model quota exhausted today", got)
	}
}

func TestNotifyEventTypesForRegionReturnsCopy(t *testing.T) {
	events := NotifyEventTypesForRegion("global")
	events[0].Name = "changed"

	if got := NotifyEventTypesForRegion("global")[0].Name; got != "Create task" {
		t.Fatalf("global event name after mutation = %q, want Create task", got)
	}
}
