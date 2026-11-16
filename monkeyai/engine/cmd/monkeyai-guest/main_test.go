package main

import "testing"

func TestBootBinding(t *testing.T) {
	raw := "console=ttyS0 monkeyai.guest=1 monkeyai.environment=env-1 monkeyai.instance=instance-1 monkeyai.boot=boot-1"
	b, err := binding(raw)
	if err != nil || b.EnvironmentID != "env-1" || b.BootID != "boot-1" {
		t.Fatal(b, err)
	}
	for _, bad := range []string{"", "monkeyai.guest=1", raw + " monkeyai.boot=other", raw + " monkeyai.environment=../bad"} {
		if _, err := binding(bad); err == nil {
			t.Fatalf("非法启动身份被接受: %s", bad)
		}
	}
}
