package skill

import (
	"archive/zip"
	"bytes"
	"fmt"
	"os"
	"strings"
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

func TestPackageSizeLimits(t *testing.T) {
	if MaxPackage != 500<<20 || MaxExpanded != 1<<30 {
		t.Fatalf("技能包应允许 500 MiB 压缩、1 GiB 解压: %d, %d", MaxPackage, MaxExpanded)
	}
	for _, tc := range []struct {
		name   string
		method uint16
		size   int
	}{
		{name: "compressed-above-old-limit", method: zip.Store, size: 21 << 20},
		{name: "expanded-above-old-limit", method: zip.Deflate, size: 51 << 20},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var b bytes.Buffer
			z := zip.NewWriter(&b)
			for name, data := range map[string][]byte{"SKILL.md": []byte(manifest), "data.bin": make([]byte, tc.size)} {
				w, err := z.CreateHeader(&zip.FileHeader{Name: name, Method: tc.method})
				if err != nil {
					t.Fatal(err)
				}
				if _, err := w.Write(data); err != nil {
					t.Fatal(err)
				}
			}
			if err := z.Close(); err != nil {
				t.Fatal(err)
			}
			p, err := Parse(b.Bytes())
			if err != nil {
				t.Fatal(err)
			}
			if len(p.Files["data.bin"]) != tc.size {
				t.Fatal("解压后文件大小不一致")
			}
		})
	}
}

func TestPackageCompressedSizeLimit(t *testing.T) {
	data := make([]byte, (500<<20)+1)
	for _, tc := range []struct {
		size int
		want string
	}{
		{size: 500 << 20, want: "无效 ZIP"},
		{size: (500 << 20) + 1, want: "技能包超过 500 MiB"},
	} {
		// 空内容只验证大小门槛；未超限时应继续进入 ZIP 格式校验。
		if _, err := Parse(data[:tc.size]); err == nil || err.Error() != tc.want {
			t.Fatalf("大小 %d 的校验错误不一致: %v", tc.size, err)
		}
	}
}

func TestPackageRejectOversizedExpandedFile(t *testing.T) {
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	if _, err := z.CreateRaw(&zip.FileHeader{Name: "data.bin", Method: zip.Store, UncompressedSize64: (1 << 30) + 1}); err != nil {
		t.Fatal(err)
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := Parse(b.Bytes()); err == nil || err.Error() != "解包大小超限" {
		t.Fatalf("应在读取内容前拒绝解压后超过 1 GiB 的文件: %v", err)
	}
}

func TestPackageManyFiles(t *testing.T) {
	for _, count := range []int{5000, 5001} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			entries := map[string]string{"SKILL.md": manifest}
			for i := 1; i < count; i++ {
				entries[fmt.Sprintf("reference-%d.md", i)] = "reference"
			}
			p, err := Parse(archive(entries))
			if err != nil {
				t.Fatal(err)
			}
			if len(p.Files) != count {
				t.Fatalf("文件数量不一致: got %d, want %d", len(p.Files), count)
			}
		})
	}
}

func TestPackageLargeManifest(t *testing.T) {
	content := strings.Repeat("正文\n", 512<<10)
	p, err := Parse(archive(map[string]string{"SKILL.md": manifest + content}))
	if err != nil {
		t.Fatal(err)
	}
	if p.Content != "Original\n"+content {
		t.Fatal("大 SKILL.md 正文未完整保留")
	}
	if _, err := Parse(archive(map[string]string{"SKILL.md": manifest + "\xff"})); err == nil {
		t.Fatal("应拒绝非 UTF-8 的 SKILL.md")
	}
}

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
