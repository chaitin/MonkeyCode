package steps

import (
	"strings"
	"testing"
)

func TestHostUpgradeCancel(t *testing.T) {
	ctx, r, _ := ctxWithFakeReporter()
	r.FormAns = [][]string{{HostDefaultInstallDir}}
	r.ConfirmAns = []bool{false}

	err := (&HostUpgrade{}).Run(ctx)
	if err == nil || !strings.Contains(err.Error(), "已取消升级") {
		t.Fatalf("expected cancel error, got %v", err)
	}
}
