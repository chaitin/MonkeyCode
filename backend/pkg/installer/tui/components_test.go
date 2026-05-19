package tui

import (
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/steps"
)

func TestFooterInputPasswordMasks(t *testing.T) {
	out := renderFooter(footerInput{label: "密码", value: "secret", password: true, hint: "至少 8 位", cursor: true}, 40, 0)
	if strings.Contains(out, "secret") {
		t.Fatalf("password should be masked: %q", out)
	}
	if !strings.Contains(out, "●") {
		t.Fatalf("missing mask char: %q", out)
	}
}

func TestFooterInputShowsHint(t *testing.T) {
	out := renderFooter(footerInput{label: "端口", value: "abc", hint: "必须是数字", cursor: true}, 40, 0)
	if !strings.Contains(out, "必须是数字") {
		t.Fatalf("missing validation hint: %q", out)
	}
}

func TestFooterMenuHighlightsSelected(t *testing.T) {
	opts := []steps.MenuOption{{Label: "安装", Value: "install"}, {Label: "退出", Value: "quit"}}
	out0 := renderFooter(footerMenu{options: opts, selected: 0}, 40, 0)
	out1 := renderFooter(footerMenu{options: opts, selected: 1}, 40, 0)
	if !strings.Contains(out0, "安装") || !strings.Contains(out0, "退出") {
		t.Fatalf("out0 missing labels: %q", out0)
	}
	if !strings.Contains(out1, "安装") || !strings.Contains(out1, "退出") {
		t.Fatalf("out1 missing labels: %q", out1)
	}
}

func TestFooterConfirmTogglesFocus(t *testing.T) {
	yesOn := renderFooter(footerConfirm{prompt: "继续?", yesFocus: true}, 40, 0)
	noOn := renderFooter(footerConfirm{prompt: "继续?", yesFocus: false}, 40, 0)
	if !strings.Contains(yesOn, "是") || !strings.Contains(yesOn, "否") {
		t.Fatalf("yesOn missing options: %q", yesOn)
	}
	if !strings.Contains(noOn, "是") || !strings.Contains(noOn, "否") {
		t.Fatalf("noOn missing options: %q", noOn)
	}
}
