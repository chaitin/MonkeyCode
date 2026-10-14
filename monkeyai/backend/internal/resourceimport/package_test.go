package resourceimport

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func packageFixture(t *testing.T, mutate func(*Manifest, map[string][]byte)) []byte {
	t.Helper()
	skillFiles := map[string][]byte{
		"SKILL.md":   []byte("---\nname: demo-skill\ndescription: Demo skill\n---\nHello\n"),
		"skill.json": []byte(`{"slug":"demo-skill","name":"demo-skill","description_i18n":{"zh-CN":"演示技能"}}`),
	}
	skillZIP, err := makeZIP(skillFiles)
	if err != nil {
		t.Fatal(err)
	}
	releaseID := "6321da1e-bf59-41a1-9ae9-da60997dd67e"
	m := Manifest{ReleaseID: releaseID, Version: 16, GeneratedAt: time.Date(2026, 10, 9, 9, 55, 18, 541099000, time.UTC),
		AgentResources: AgentResources{Skills: []Entry{{Type: "skill", Slug: "demo-skill", Name: "demo-skill", Path: "agent/skills/demo.zip", SHA256: digest(skillZIP), DescriptionI18n: map[string]string{"zh-CN": "演示技能"}}},
			Rules: []Entry{}, Connectors: []Entry{}, Experts: []Entry{}},
		DesignResources: DesignResources{Templates: []json.RawMessage{}, DesignSystems: []json.RawMessage{}, Styles: []json.RawMessage{}, Directions: []json.RawMessage{}}, StaticAssets: []Asset{}}
	files := map[string][]byte{"agent/skills/demo.zip": skillZIP}
	if mutate != nil {
		mutate(&m, files)
	}
	canonical, err := canonicalManifest(m)
	if err != nil {
		t.Fatal(err)
	}
	m.ManifestSHA256 = digest(canonical)
	release := Release{Publisher: Publisher{Name: "monkeyai-respub", Version: "16"}, ReleaseID: releaseID, Version: 16,
		PublishedAt: m.GeneratedAt, ExportedAt: m.GeneratedAt, ManifestSHA256: m.ManifestSHA256,
		Counts: map[string]int{"skill": len(m.AgentResources.Skills), "rule": len(m.AgentResources.Rules), "connector": len(m.AgentResources.Connectors), "expert": len(m.AgentResources.Experts)}}
	files["release.json"], _ = json.Marshal(release)
	files["manifest.json"], _ = json.Marshal(m)
	paths := make([]string, 0, len(files)-1)
	for name := range files {
		if name != "release.json" {
			paths = append(paths, name)
		}
	}
	slices.Sort(paths)
	var checks strings.Builder
	for _, name := range paths {
		checks.WriteString(strings.TrimPrefix(digest(files[name]), "sha256:") + "  " + name + "\n")
	}
	files["CHECKSUMS.sha256"] = []byte(checks.String())
	archive, err := makeZIP(files)
	if err != nil {
		t.Fatal(err)
	}
	return archive
}

func TestCanonicalManifestWithTags(t *testing.T) {
	const data = `{
		"release_id":"ad77973a-6e66-4ff3-a78e-823ab715a9ef",
		"version":8,
		"generated_at":"2026-10-14T06:55:37.369472Z",
		"agent_resources":{
			"skills":[{
				"type":"skill","slug":"copywriter","name":"copywriter","tags":["百智办公"],
				"path":"agent/skills/copywriter.zip",
				"sha256":"sha256:c196165f838102d71030304ce4750f647468b6016220db43e00a9c26a2089a2f",
				"description_i18n":{"zh-CN":"撰写引人入胜的 UX 文案、营销内容和产品信息。适用于编写按钮标签、错误提示、落地页、电子邮件、CTA、空状态、工具提示或任何面向用户的文本。"}
			}],
			"rules":[],"connectors":[],"experts":null
		},
		"design_resources":{"templates":[],"design_systems":[],"styles":[],"directions":[]},
		"static_assets":[]
	}`
	var manifest Manifest
	if err := json.Unmarshal([]byte(data), &manifest); err != nil {
		t.Fatal(err)
	}
	canonical, err := canonicalManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	const want = "sha256:7caadd417ae5063f7a00dbf09c829c080e1153d28f44e25684297885e7e4466a"
	if got := digest(canonical); got != want {
		t.Fatalf("带标签的发布端 manifest 摘要不匹配: got %s, want %s", got, want)
	}
}

func TestPublishedReleaseZIP(t *testing.T) {
	name := os.Getenv("MONKEYAI_RELEASE_FIXTURE_ZIP")
	if name == "" {
		t.Skip("未指定本地发布 ZIP")
	}
	file, err := os.Open(name)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParseReader(file, info.Size())
	if err != nil {
		t.Fatal(err)
	}
	resources, err := ParseResources(pkg)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("发布包 v%d 解析通过: %d Skill, %d Rule, %d Connector, %d Expert",
		pkg.Manifest.Version, len(resources.Skills), len(resources.Rules), len(resources.Connectors), len(resources.Experts))
}

func TestPublishedReleaseFixture(t *testing.T) {
	root := os.Getenv("MONKEYAI_RELEASE_FIXTURE_DIR")
	if root == "" {
		t.Skip("未指定本地发布包目录")
	}
	files := map[string][]byte{}
	for _, name := range []string{"release.json", "manifest.json", "CHECKSUMS.sha256"} {
		data, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			t.Fatal(err)
		}
		files[name] = data
	}
	for _, line := range strings.Split(strings.TrimSpace(string(files["CHECKSUMS.sha256"])), "\n") {
		parts := strings.SplitN(line, "  ", 2)
		if len(parts) != 2 || !filepath.IsLocal(parts[1]) {
			t.Fatalf("校验清单路径无效: %q", line)
		}
		data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(parts[1])))
		if err != nil {
			t.Fatal(err)
		}
		files[parts[1]] = data
	}
	archive, err := makeZIP(files)
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := Parse(archive)
	if err != nil {
		t.Fatal(err)
	}
	resources, err := ParseResources(pkg)
	if err != nil {
		t.Fatal(err)
	}
	if len(resources.Skills) != 34 || len(resources.Rules) != 1 || len(resources.Connectors) != 2 || len(resources.Experts) != 2 {
		t.Fatalf("发布包 Agent 资源数量不匹配: %+v", pkg.Release.Counts)
	}
	for _, slug := range []string{"transcription-automation", "content-repurposer", "hyperframes-local-promo"} {
		if !resources.Skills[slug].Normalized || len(resources.Skills[slug].Normalizations) == 0 {
			t.Fatalf("样本中的异常 frontmatter 未预览规范化: %s", slug)
		}
	}
}

func TestParseReaderKeepsArtifactsOnDisk(t *testing.T) {
	data := packageFixture(t, nil)
	name := filepath.Join(t.TempDir(), "release.zip")
	if err := os.WriteFile(name, data, 0600); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(name)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	pkg, err := ParseReader(file, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if len(pkg.Files) != 3 {
		t.Fatalf("外层产物不应全部加载到内存: %d", len(pkg.Files))
	}
	resources, err := ParseResources(pkg)
	if err != nil {
		t.Fatal(err)
	}
	item := resources.Skills["demo-skill"]
	if len(item.Package.Bytes) != 0 || len(item.Package.Files) != 0 || item.StoredSize == 0 {
		t.Fatal("预览阶段不应保留技能包字节")
	}
	stored, err := pkg.SkillBytes(item)
	if err != nil {
		t.Fatal(err)
	}
	original, err := pkg.ReadFile("agent/skills/demo.zip")
	if err != nil || !bytes.Equal(stored, original) {
		t.Fatalf("按需读取的技能包不一致: %v", err)
	}
	if _, err := ParseReader(bytes.NewReader(nil), MaxPackage+1); err == nil {
		t.Fatal("应提前拒绝超过 2 GiB 的压缩包")
	}
}

func TestParsePackageAndResources(t *testing.T) {
	data := packageFixture(t, nil)
	pkg, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	resources, err := ParseResources(pkg)
	if err != nil {
		t.Fatal(err)
	}
	if resources.Skills["demo-skill"].Package.Name != "demo-skill" || len(resources.Skills) != 1 {
		t.Fatalf("技能解析异常: %+v", resources.Skills)
	}
}

func TestIgnoresReleaseCounts(t *testing.T) {
	files, err := readZIP(packageFixture(t, nil), MaxPackage, MaxExpanded, MaxFiles, MaxFile)
	if err != nil {
		t.Fatal(err)
	}
	var release Release
	if err = json.Unmarshal(files["release.json"], &release); err != nil {
		t.Fatal(err)
	}
	release.Counts = map[string]int{"skill": 99, "rule": 42}
	files["release.json"], err = json.Marshal(release)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := makeZIP(files)
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := Parse(archive)
	if err != nil {
		t.Fatalf("release.json 的展示数量不应影响解析: %v", err)
	}
	if len(pkg.Manifest.AgentResources.Skills) != 1 {
		t.Fatal("应以 manifest 的资源清单为准")
	}
}

func TestNormalizeInvalidSkillName(t *testing.T) {
	data := packageFixture(t, func(m *Manifest, files map[string][]byte) {
		z, err := makeZIP(map[string][]byte{
			"SKILL.md":   []byte("---\nname: Demo Skill\ndescription: Demo skill\n---\nHello\n"),
			"skill.json": []byte(`{"slug":"demo-skill","name":"demo-skill"}`),
		})
		if err != nil {
			t.Fatal(err)
		}
		files["agent/skills/demo.zip"] = z
		m.AgentResources.Skills[0].SHA256 = digest(z)
		m.AgentResources.Skills[0].DescriptionI18n = nil
	})
	pkg, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	resources, err := ParseResources(pkg)
	if err != nil {
		t.Fatal(err)
	}
	item := resources.Skills["demo-skill"]
	if !item.Normalized || item.Package.Name != "demo-skill" || bytes.Equal(item.Package.Bytes, pkg.Files["agent/skills/demo.zip"]) {
		t.Fatal("不合法技能名称未在存储包中规范化")
	}
}

func TestNormalizeUnquotedDescription(t *testing.T) {
	data := packageFixture(t, func(m *Manifest, files map[string][]byte) {
		z, err := makeZIP(map[string][]byte{
			"SKILL.md":   []byte("---\nname: demo-skill\ndescription: Formats: slides and quiz\n---\nBody remains untouched\n"),
			"skill.json": []byte(`{"slug":"demo-skill","name":"demo-skill"}`),
		})
		if err != nil {
			t.Fatal(err)
		}
		files["agent/skills/demo.zip"] = z
		m.AgentResources.Skills[0].SHA256 = digest(z)
		m.AgentResources.Skills[0].DescriptionI18n = nil
	})
	pkg, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	resources, err := ParseResources(pkg)
	if err != nil {
		t.Fatal(err)
	}
	item := resources.Skills["demo-skill"]
	if !item.Normalized || item.Package.Description != "Formats: slides and quiz" ||
		!strings.Contains(item.Package.Content, "Body remains untouched") || len(item.Normalizations) != 1 {
		t.Fatalf("只应修复无效的 description 行: %+v", item.Normalizations)
	}
}

func TestStaticAssetsVerifiedButIgnored(t *testing.T) {
	data := packageFixture(t, func(m *Manifest, files map[string][]byte) {
		files["static/logo/logo.png"] = []byte("test")
		m.StaticAssets = []Asset{{Slug: "logo", Name: "logo.png", Kind: "image", MIME: "image/png", Size: 4, Download: "/downloads/logo", Hash: "business-hash"}}
	})
	pkg, err := Parse(data)
	if err != nil || len(pkg.Manifest.StaticAssets) != 1 {
		t.Fatalf("静态资源有效时不应阻断 Agent 导入: %v", err)
	}
	if _, err = ParseResources(pkg); err != nil {
		t.Fatal(err)
	}
}

func TestRejectDuplicateSlugAcrossTypes(t *testing.T) {
	data := packageFixture(t, func(m *Manifest, files map[string][]byte) {
		rule := []byte(`{"slug":"demo-skill","name":"Rule","content":"example"}`)
		files["agent/rules/rule.json"] = rule
		m.AgentResources.Rules = []Entry{{Type: "rule", Slug: "demo-skill", Name: "Rule", Path: "agent/rules/rule.json", SHA256: digest(rule)}}
	})
	if _, err := Parse(data); err == nil {
		t.Fatal("同 publisher 的跨类型重复 slug 未拒绝")
	}
}
