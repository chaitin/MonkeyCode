package resourceimport

import (
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"
)

func TestTaggedManifestDigest(t *testing.T) {
	data, err := os.ReadFile("testdata/manifest-r0008.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	canonical, err := canonicalManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if digest(canonical) != manifest.ManifestSHA256 {
		t.Fatalf("带标签的发布端 manifest 摘要不兼容: %s", digest(canonical))
	}
	for _, entry := range append(append([]Entry{}, manifest.AgentResources.Skills...), manifest.AgentResources.Rules...) {
		if !slices.Equal(entry.Tags, []string{"百智办公"}) {
			t.Fatalf("标签丢失: %+v", entry)
		}
	}
}

func TestParseTags(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   []string
		want []string
	}{
		{"旧包不声明标签", nil, nil},
		{"显式清空标签", []string{}, []string{}},
		{"去空格去重并排序", []string{" 百智办公 ", "Work", "work", "研发"}, []string{"Work", "百智办公", "研发"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pkg, err := Parse(packageFixture(t, func(m *Manifest, _ map[string][]byte) {
				m.AgentResources.Skills[0].Tags = tc.in
			}))
			if err != nil {
				t.Fatal(err)
			}
			got := pkg.Manifest.AgentResources.Skills[0].Tags
			if !slices.Equal(got, tc.want) || (got == nil) != (tc.want == nil) {
				t.Fatalf("标签不匹配: %#v，预期 %#v", got, tc.want)
			}
			resources, err := ParseResources(pkg)
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(resources.Skills["demo-skill"].Entry.Tags, tc.want) {
				t.Fatal("解析资源时丢失标签")
			}
		})
	}
	for _, name := range []string{"", " \t", strings.Repeat("a", 101), "bad\x00tag"} {
		t.Run("拒绝无效名称"+name, func(t *testing.T) {
			if _, err := Parse(packageFixture(t, func(m *Manifest, _ map[string][]byte) {
				m.AgentResources.Skills[0].Tags = []string{name}
			})); err == nil {
				t.Fatal("无效标签未在预检阶段拒绝")
			}
		})
	}
}
