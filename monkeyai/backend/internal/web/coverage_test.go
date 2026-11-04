package web

import (
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web/internal/i18n"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"unicode"
)

func TestBusinessErrorCodesHaveTranslations(t *testing.T) {
	codePattern := regexp.MustCompile(`^[a-z][a-z0-9_]{1,79}$`)
	literal := func(value ast.Expr) string {
		if value, ok := value.(*ast.BasicLit); ok && value.Kind == token.STRING {
			text, _ := strconv.Unquote(value.Value)
			return text
		}
		return ""
	}
	err := filepath.WalkDir("..", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if entry.Name() == "sqlc" || entry.Name() == "testmember" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			return err
		}
		check := func(code string) {
			if codePattern.MatchString(code) && i18n.HasCode(code) == false {
				t.Errorf("%s: 业务错误码 %q 缺少公共翻译", path, code)
			}
		}
		ast.Inspect(file, func(node ast.Node) bool {
			switch value := node.(type) {
			case *ast.CompositeLit:
				code, hasMessage := "", false
				for _, item := range value.Elts {
					field, ok := item.(*ast.KeyValueExpr)
					if !ok {
						continue
					}
					if key, ok := field.Key.(*ast.Ident); ok {
						if key.Name == "Code" {
							code = literal(field.Value)
						}
						if key.Name == "Message" || key.Name == "Description" {
							hasMessage = true
						}
					}
				}
				if hasMessage {
					check(code)
				}
			case *ast.CallExpr:
				name := ""
				switch function := value.Fun.(type) {
				case *ast.Ident:
					name = function.Name
				case *ast.SelectorExpr:
					name = function.Sel.Name
				}
				switch name {
				case "BadRequest", "Internal":
					if len(value.Args) > 0 {
						check(literal(value.Args[0]))
					}
				case "InvalidCode", "oauthError", "writeError", "sessionFailure", "fault", "fail":
					for i := 1; i < len(value.Args); i++ {
						code, message := literal(value.Args[i-1]), literal(value.Args[i])
						if strings.ContainsFunc(message, func(r rune) bool { return unicode.Is(unicode.Han, r) }) {
							check(code)
						}
					}
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestDirectErrorOutputsUseSharedTranslation(t *testing.T) {
	err := filepath.WalkDir("..", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if entry.Name() == "sqlc" || entry.Name() == "testmember" || entry.Name() == "web" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
		if err != nil {
			return err
		}
		translated := func(value ast.Expr) bool {
			call, ok := value.(*ast.CallExpr)
			if !ok {
				return false
			}
			function, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return false
			}
			owner, ok := function.X.(*ast.Ident)
			return ok && owner.Name == "web"
		}
		ast.Inspect(file, func(node ast.Node) bool {
			switch value := node.(type) {
			case *ast.KeyValueExpr:
				if key, ok := value.Key.(*ast.BasicLit); ok && key.Kind == token.STRING {
					name, _ := strconv.Unquote(key.Value)
					if name == "message" {
						if literal, ok := value.Value.(*ast.BasicLit); ok && literal.Value == `""` {
							return true
						}
						if !translated(value.Value) {
							t.Errorf("%s: message 绕过公共翻译", path)
						}
					}
				}
			case *ast.CallExpr:
				if function, ok := value.Fun.(*ast.SelectorExpr); ok {
					owner, ok := function.X.(*ast.Ident)
					if ok && owner.Name == "http" {
						if function.Sel.Name == "NotFound" || function.Sel.Name == "Error" && len(value.Args) > 1 && !translated(value.Args[1]) {
							t.Errorf("%s: HTTP 错误绕过公共翻译", path)
						}
					}
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
