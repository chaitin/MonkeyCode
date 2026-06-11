package errcode_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/GoYoko/web/locale"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"golang.org/x/text/language"
)

func TestTeamMemberLimitExceededHasChineseMessage(t *testing.T) {
	localizer := locale.NewLocalizerWithFile(language.Chinese, errcode.LocalFS, []string{"locale.zh.toml", "locale.en.toml"})

	got := localizer.Message("zh", "err-team-member-limit-exceeded", nil)

	if got != "团队成员数量已达上限" {
		t.Fatalf("message = %q, want %q", got, "团队成员数量已达上限")
	}
}

func TestLicenseMachineMismatchHasChineseMessage(t *testing.T) {
	localizer := locale.NewLocalizerWithFile(language.Chinese, errcode.LocalFS, []string{"locale.zh.toml", "locale.en.toml"})

	got := localizer.Message("zh", "err-license-machine-mismatch", nil)

	if got != "License 机器码不匹配" {
		t.Fatalf("message = %q, want %q", got, "License 机器码不匹配")
	}
}

func TestErrCodeMessagesHaveLocaleEntries(t *testing.T) {
	keys := errCodeKeys(t)
	localizer := locale.NewLocalizerWithFile(language.Chinese, errcode.LocalFS, []string{"locale.zh.toml", "locale.en.toml"})

	for _, lang := range []string{"zh", "en"} {
		for _, key := range keys {
			t.Run(lang+"/"+key, func(t *testing.T) {
				got := localizer.Message(lang, key, nil)
				if strings.Contains(got, "message \"") {
					t.Fatalf("missing locale message: %s", got)
				}
			})
		}
	}
}

func errCodeKeys(t *testing.T) []string {
	t.Helper()

	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, "errcode.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}

	keySet := make(map[string]struct{})
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		if len(call.Args) < 3 {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "NewErr" {
			return true
		}
		key, ok := call.Args[2].(*ast.BasicLit)
		if !ok || key.Kind != token.STRING {
			return true
		}
		value, err := strconv.Unquote(key.Value)
		if err != nil {
			t.Fatal(err)
		}
		keySet[value] = struct{}{}
		return true
	})

	keys := make([]string, 0, len(keySet))
	for key := range keySet {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
