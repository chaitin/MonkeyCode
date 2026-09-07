package skill

import (
	"archive/zip"
	"bytes"
	"os"
	"testing"
)

func archive(entries map[string]string) []byte {
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	for n, v := range entries {
		w, _ := z.Create(n)
		_, _ = w.Write([]byte(v))
	}
	_ = z.Close()
	return b.Bytes()
}

const manifest = "---\nname: review\ndescription: Review\ncustom: kept\n---\nOriginal\n"

func TestPackageRewrite(t *testing.T) {
	p, err := Parse(archive(map[string]string{"root/SKILL.md": manifest, "root/scripts/test.sh": "echo ok"}))
	if err != nil {
		t.Fatal(err)
	}
	next, err := p.Rewrite("new-name", "New description", "Changed\n")
	if err != nil {
		t.Fatal(err)
	}
	if next.SHA == p.SHA || next.Name != "new-name" || next.Content != "Changed\n" || next.Front["custom"] != "kept" || string(next.Files["scripts/test.sh"]) != "echo ok" {
		t.Fatalf("包更新未保持文件和元信息: %+v", next)
	}
	again, err := next.Rewrite("new-name", "New description", "Changed\n")
	if err != nil || again.SHA != next.SHA {
		t.Fatal("重建结果不确定")
	}
}
func TestUnsafePackages(t *testing.T) {
	for name, entries := range map[string]map[string]string{"traversal": {"SKILL.md": manifest, "../outside": "x"}, "absolute": {"SKILL.md": manifest, "/etc/file": "x"}, "backslash": {"SKILL.md": manifest, `a\b`: "x"}, "multiple": {"a/SKILL.md": manifest, "b/SKILL.md": manifest}, "outside": {"a/SKILL.md": manifest, "other": "x"}, "invalidname": {"SKILL.md": "---\nname: ../bad\ndescription: Bad\n---\nBad"}} {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse(archive(entries)); err == nil {
				t.Fatal("不安全技能包被接受")
			}
		})
	}
}
func TestRejectSymlink(t *testing.T) {
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	h := &zip.FileHeader{Name: "SKILL.md", Method: zip.Store}
	h.SetMode(os.ModeSymlink | 0777)
	w, _ := z.CreateHeader(h)
	_, _ = w.Write([]byte("/tmp/secret"))
	_ = z.Close()
	if _, err := Parse(b.Bytes()); err == nil {
		t.Fatal("链接被接受")
	}
}
