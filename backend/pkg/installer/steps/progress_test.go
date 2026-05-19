package steps

import (
	"strings"
	"testing"
)

func TestContextLogAddsStepProgressPrefix(t *testing.T) {
	ctx, r, _ := ctxWithFakeReporter()
	ctx.Progress = Progress{Current: 2, Total: 4}

	ctx.Log("安装目录 %s", "/data/myapp")

	if len(r.Logs) != 1 {
		t.Fatalf("Logs len = %d", len(r.Logs))
	}
	if !strings.HasPrefix(r.Logs[0], "[2/4] 安装目录 /data/myapp") {
		t.Fatalf("unexpected log: %q", r.Logs[0])
	}
}

func TestContextLogSkipsPrefixWithoutProgress(t *testing.T) {
	ctx, r, _ := ctxWithFakeReporter()

	ctx.Log("安装目录 %s", "/data/myapp")

	if len(r.Logs) != 1 {
		t.Fatalf("Logs len = %d", len(r.Logs))
	}
	if r.Logs[0] != "安装目录 /data/myapp" {
		t.Fatalf("unexpected log: %q", r.Logs[0])
	}
}
