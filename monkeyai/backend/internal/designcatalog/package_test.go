package designcatalog

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesignPackage(t *testing.T) {
	p, err := ParseFile(t.Context(), "../../testdata/design-contract/v1/release.zip")
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if p.ReleaseID != "70000000-0000-0000-0000-000000000001" || len(p.Entries) != 5 {
		t.Fatalf("源身份/资源数量错误: %+v", p.SnapshotRef)
	}
	for _, e := range p.Entries {
		for _, f := range e.Files {
			b, err := os.ReadFile(p.Source(e.Kind, e.ID, f.Path))
			if err != nil {
				t.Fatal(err)
			}
			if Hash(b) != f.SHA256 || int64(len(b)) != f.Size {
				t.Fatalf("源文件错误: %s", f.Path)
			}
		}
	}
	e := p.Entry("template", "sample.bundle")
	if e.SourceSkillPath == nil || *e.SourceSkillPath != "wrap/SKILL.md" {
		t.Fatalf("技能路径未恢复: %+v", e.SourceSkillPath)
	}
	original, err := os.ReadFile(p.Source("template", "sample.bundle", "template.json"))
	if err != nil || string(original) != "upstream template\n" {
		t.Fatalf("保留名源文件被覆盖: %s %v", original, err)
	}
	if p.Entry("template", "sample.prompt").SourceSkillPath != nil {
		t.Fatal("无技能模板不应解析遗留路径")
	}
	root := p.dir
	p.Close()
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatal("临时文件未清理")
	}
}

func TestMetadataBudget(t *testing.T) {
	r := &parser{retained: MaxRetainedMetadata - 1}
	e := &Entry{}
	if err := r.keepExport(e, []byte("{}")); err == nil || len(e.Export) != 0 {
		t.Fatal("发布元数据超预算仍被保留")
	}
}

func TestCanonical(t *testing.T) {
	vectors, err := os.ReadFile("../../testdata/design-contract/v1/canonical.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Input     json.RawMessage `json:"input"`
		Canonical string          `json:"canonical"`
		SHA256    string          `json:"sha256"`
	}
	if err = json.Unmarshal(vectors, &cases); err != nil {
		t.Fatal(err)
	}
	for _, v := range cases {
		got, err := Canonical(v.Input)
		if err != nil || string(got) != v.Canonical || Hash(got) != v.SHA256 {
			t.Fatalf("JCS 向量不符: %s %s %v", v.Input, got, err)
		}
	}
	for _, bad := range [][]byte{[]byte(`{"a":1,"a":2}`), []byte(`{"x":"\ud800"}`), []byte(`{"x":"\udc00\ud800"}`), []byte("{\"x\":\"\xff\"}"), []byte(`1e9999`)} {
		if _, err := Canonical(bad); err == nil {
			t.Fatalf("非法 JCS 被接受: %q", bad)
		}
	}
}

func TestRealDesignPackage(t *testing.T) {
	name := os.Getenv("MONKEYAI_DESIGN_FIXTURE_ZIP")
	if name == "" {
		t.Skip("设置 MONKEYAI_DESIGN_FIXTURE_ZIP 验证真实发布包")
	}
	p, err := ParseFile(context.Background(), name)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if len(p.Entries) != 472 {
		t.Fatalf("真实包资源数量: %d", len(p.Entries))
	}
	counts := map[string]int{}
	for _, e := range p.Entries {
		counts[e.Kind]++
	}
	t.Logf("真实包 %s: %+v", p.ReleaseID, counts)
}

func TestSnapshotDigest(t *testing.T) {
	p, err := ParseFile(t.Context(), "../../testdata/design-contract/v1/release.zip")
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	a, err := p.Digest()
	if err != nil {
		t.Fatal(err)
	}
	p.Entries[0].CatalogRank = new(int64)
	b, _ := p.Digest()
	if a == b {
		t.Fatal("缺省秩与0必须区分")
	}
	p.Entries[0].CatalogRank = nil
	p.Taxonomy.Categories[0].Count++
	c, _ := p.Digest()
	if a == c {
		t.Fatal("taxonomy变化必须改变快照指纹")
	}
}

func TestPackageCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	p, err := ParseFile(ctx, "../../testdata/design-contract/v1/release.zip")
	if err == nil {
		p.Close()
		t.Fatal("取消的导入不应继续")
	}
}

func TestFixturesFrozen(t *testing.T) {
	dir := "../../testdata/design-contract/v1"
	raw, err := os.ReadFile(filepath.Join(dir, "SHA256SUMS"))
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		parts := strings.SplitN(line, "  ", 2)
		if len(parts) != 2 {
			t.Fatal(line)
		}
		b, err := os.ReadFile(filepath.Join(dir, parts[1]))
		if err != nil || !bytes.Equal([]byte(strings.TrimPrefix(Hash(b), "sha256:")), []byte(parts[0])) {
			t.Fatalf("夹具已变化: %s %v", line, err)
		}
	}
}
