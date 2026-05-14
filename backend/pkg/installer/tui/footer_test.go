package tui

import (
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/steps"
)

func TestChasingPositions(t *testing.T) {
	got := chasingPositions(5, 0)
	want := []int{0, 1, 2}
	if len(got) != 3 {
		t.Fatalf("want 3 positions, got %d", len(got))
	}
	for i, w := range want {
		if got[i] != w {
			t.Fatalf("tick=0 pos[%d]=%d, want %d", i, got[i], w)
		}
	}

	got = chasingPositions(5, 1)
	want = []int{1, 2, 3}
	for i, w := range want {
		if got[i] != w {
			t.Fatalf("tick=1 pos[%d]=%d, want %d", i, got[i], w)
		}
	}

	span := 5 + chaseLen
	got = chasingPositions(5, 6)
	want = []int{6 % span, (6 + 1) % span, (6 + 2) % span}
	for i, w := range want {
		if got[i] != w {
			t.Fatalf("tick=6 pos[%d]=%d, want %d", i, got[i], w)
		}
	}
}

func TestRenderFooterMenu(t *testing.T) {
	out := renderFooter(footerMenu{
		options:  []steps.MenuOption{{Label: "安装", Value: "install"}, {Label: "退出", Value: "quit"}},
		selected: 0,
	}, 40, 0)
	if !strings.Contains(out, "安装") {
		t.Fatalf("missing 安装: %q", out)
	}
	if !strings.Contains(out, "退出") {
		t.Fatalf("missing 退出: %q", out)
	}
	if strings.Count(out, "─") < 20 {
		t.Fatalf("missing border lines: %q", out)
	}
}

func TestRenderFooterStatusContainsText(t *testing.T) {
	out := renderFooter(footerStatus{title: "检查 Docker...", nextHint: "下一步: 安装 Docker"}, 40, 0)
	if !strings.Contains(out, "检查 Docker") {
		t.Fatalf("missing title: %q", out)
	}
	if !strings.Contains(out, "下一步") {
		t.Fatalf("missing hint: %q", out)
	}
}

func TestRenderFooterExit(t *testing.T) {
	out := renderFooter(footerExit{}, 40, 0)
	if !strings.Contains(out, "退出") {
		t.Fatalf("missing 退出: %q", out)
	}
	if !strings.Contains(out, "enter") {
		t.Fatalf("missing enter hint: %q", out)
	}
}
