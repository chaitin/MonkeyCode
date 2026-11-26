package kb

import (
	"bytes"
	"strings"
	"testing"
)

func TestImportImagesPreserveLiterals(t *testing.T) {
	content := "# 配置教程\n将资源目录设为 `../assets/icons`。\n\n" +
		"```markdown\n![logo](../assets/example.png)\n```\n\n" +
		"Use `![logo](../assets/example.png)`.\n\n" +
		`\![escaped](../assets/example.png)` + "\n\n" +
		"    ![indented](../assets/example.png)\n\n" +
		"[普通链接](../assets/icons)\n\n" +
		"<!-- ![comment](../assets/example.png) -->\n"
	raw := importFixture(t, func(f map[string][]byte) { f["knowledge/manual/doc.md"] = []byte(content) })
	p, err := ParseImportPackage(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	actual, err := p.Books[0].importImageContent(content, "new-kb")
	if err != nil || actual != content {
		t.Fatalf("literal content changed: %s (%v)", actual, err)
	}
}

func TestImportImagesRewriteActualNodes(t *testing.T) {
	name := strings.Repeat("a", 64) + ".png"
	target := "../assets/" + name
	book := ImportBook{Assets: map[string]ImportAsset{name: {Name: name}}}
	for _, source := range []string{
		`![图](<` + target + `> "标题")`,
		`<img alt="图" src="` + target + `">`,
		`<IMG SRC=` + target + `>`,
		`> - ![图](` + target + `)`,
		"![图][ref]\n\n[ref]: " + target + " \"标题\"\n",
		"![ref][]\n\n[ref]: " + target + "\n",
		"![ref]\n\n[ref]: " + target + "\n",
		"[![图](" + target + ")](https://example.com)",
		"| A | B |\n| --- | --- |\n| `![example](../assets/sample.png)` | ![图](" + target + ") |",
		"![unclosed\n\n![图](" + target + ")",
	} {
		t.Run(source, func(t *testing.T) {
			actual, err := book.importImageContent(source, "new-kb")
			if err != nil || !strings.Contains(actual, assetURL("new-kb", name)) {
				t.Fatalf("image not rewritten: %s (%v)", actual, err)
			}
		})
	}
	shared := "![图][ref] and [ordinary][ref]\n\n[ref]: " + target + " \"shared\"\n"
	actual, err := book.importImageContent(shared, "new-kb")
	if err != nil || !strings.Contains(actual, "[ordinary][ref]") || !strings.Contains(actual, "[ref]: "+target) {
		t.Fatalf("shared reference changed: %s (%v)", actual, err)
	}
	for _, source := range []string{`<img src="../assets/missing.png">`, "![missing](../assets/missing.png)", "![ref]\n\n[ref]: ../assets/missing.png"} {
		if _, err = book.importImageContent(source, ""); err == nil {
			t.Fatal("missing real image accepted")
		}
	}
}
