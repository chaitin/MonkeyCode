package resourceimport

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
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
	m := Manifest{ReleaseID: releaseID, Version: 16, ManifestSHA256: "unchecked-manifest-digest",
		AgentResources: AgentResources{Skills: []Entry{{Type: "skill", Slug: "demo-skill", Name: "demo-skill", Path: "agent/skills/demo.zip", SHA256: digest(skillZIP), DescriptionI18n: map[string]string{"zh-CN": "演示技能"}}},
			Rules: []Entry{}, Connectors: []Entry{}, Experts: []Entry{}},
		DesignResources: DesignResources{Templates: []json.RawMessage{}, DesignSystems: []json.RawMessage{}, Styles: []json.RawMessage{}, Directions: []json.RawMessage{}}, StaticAssets: []Asset{}}
	files := map[string][]byte{"agent/skills/demo.zip": skillZIP}
	if mutate != nil {
		mutate(&m, files)
	}
	release := Release{Publisher: Publisher{Name: "monkeyai-respub", Version: "16"}, ReleaseID: releaseID, Version: 16,
		ManifestSHA256: "different-unchecked-digest",
		Counts:         map[string]int{"skill": len(m.AgentResources.Skills), "rule": len(m.AgentResources.Rules), "connector": len(m.AgentResources.Connectors), "expert": len(m.AgentResources.Experts)}}
	files["release.json"], _ = json.Marshal(release)
	files["manifest.json"], _ = json.Marshal(m)
	files["CHECKSUMS.sha256"] = []byte("unchecked file checksums\n")
	archive, err := makeZIP(files)
	if err != nil {
		t.Fatal(err)
	}
	return archive
}

func TestAcceptLoosePackageMetadata(t *testing.T) {
	data := packageFixture(t, func(m *Manifest, files map[string][]byte) {
		m.ReleaseID, m.Version, m.ManifestSHA256 = "not-a-uuid", -1, "wrong-digest"
		m.GeneratedAt = json.RawMessage(`{"any":"value"}`)
		m.AgentResources.Skills[0] = Entry{Path: "agent/skills/demo.zip", SHA256: "wrong-artifact-digest"}
		m.DesignResources.Templates = []json.RawMessage{json.RawMessage(`{"ignored":true}`)}
		m.StaticAssets = []Asset{{Size: -1}}
		files["extra.txt"] = []byte("undeclared file")
	})
	pkg, err := ParseReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	resources, err := ParseResources(pkg)
	if err != nil {
		t.Fatal(err)
	}
	item := resources.Skills["demo"]
	if len(resources.Skills) != 1 || item.Package.Name != "demo-skill" || pkg.Release.Version < 1 {
		t.Fatalf("缺省字段应正常回退并导入: %+v", resources)
	}
	if item.SourceSHA == "wrong-artifact-digest" {
		t.Fatal("来源记录应使用实际产物，不依赖包内声明的摘要")
	}
}

func TestAcceptMissingOptionalMetadata(t *testing.T) {
	files, err := readZIP(packageFixture(t, nil), MaxPackage, MaxExpanded, MaxFiles, MaxFile)
	if err != nil {
		t.Fatal(err)
	}
	delete(files, "release.json")
	delete(files, "CHECKSUMS.sha256")
	files["manifest.json"] = []byte(`{"agent_resources":{"skills":[{"path":"agent/skills/demo.zip","tags":42,"name_i18n":false}]}}`)
	data, err := makeZIP(files)
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParseReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	resources, err := ParseResources(pkg)
	if err != nil || len(resources.Skills) != 1 || pkg.Release.Publisher.Name != "resource-package" {
		t.Fatalf("省略可选元数据仍应可导入: %v", err)
	}
}

func TestPackageJSONSyntaxOnly(t *testing.T) {
	for _, input := range []string{`{}`, `null`, `[]`, `{"version":"old","generated_at":false,"unknown":true}`} {
		data, err := makeZIP(map[string][]byte{"manifest.json": []byte(input)})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := Parse(data); err != nil {
			t.Fatalf("合法 JSON 不应被字段检查阻断: %s: %v", input, err)
		}
	}
	for _, input := range []string{``, `{"version":`, `{} {}`} {
		data, err := makeZIP(map[string][]byte{"manifest.json": []byte(input)})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := Parse(data); err == nil {
			t.Fatalf("非法 JSON 应被拒绝: %s", input)
		}
	}
}

func TestResourceJSONWithoutFieldValidation(t *testing.T) {
	data := packageFixture(t, func(m *Manifest, files map[string][]byte) {
		skillZIP, err := makeZIP(map[string][]byte{
			"SKILL.md":   []byte("---\nname: demo-skill\ndescription: Demo\n---\nBody\n"),
			"skill.json": []byte(`{"slug":42,"name":false,"description_i18n":{"bad tag":""},"unknown":true}`),
		})
		if err != nil {
			t.Fatal(err)
		}
		files["agent/skills/demo.zip"] = skillZIP
		files["rule.json"] = []byte(`{"slug":"other","name":false,"content":null,"unknown":true}`)
		files["connector.json"] = []byte(`{"config":{"transport":"other","timeout_ms":-1,"header_schema":{"unknown":true},"auth":{"mode":"future","extra":true},"oauth":{"config_source":"manual","extra":true}}}`)
		expertZIP, err := makeZIP(map[string][]byte{
			"expert.json": []byte(`{"slug":"other","name":false,"prompt_path":"custom.md","avatar":"picture.bin","depends_on":{"skills":["demo-skill","missing"],"rules":["test-rule","missing"],"connectors":["test-connector","missing"]},"unknown":true}`),
			"custom.md":   []byte("Custom prompt"), "picture.bin": []byte("avatar"), "extra.txt": []byte("ignored"),
			"skills/demo-skill/SKILL.md": []byte("different embedded skill"),
		})
		if err != nil {
			t.Fatal(err)
		}
		files["expert.zip"] = expertZIP
		m.AgentResources.Rules = []Entry{{Slug: "test-rule", Path: "rule.json"}}
		m.AgentResources.Connectors = []Entry{{Slug: "test-connector", Path: "connector.json"}}
		m.AgentResources.Experts = []Entry{{Slug: "test-expert", Path: "expert.zip"}}
	})
	pkg, err := ParseReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	resources, err := ParseResources(pkg)
	if err != nil {
		t.Fatal(err)
	}
	expert := resources.Experts["test-expert"]
	if expert.Prompt != "Custom prompt" || len(expert.Skills) != 1 || len(expert.Rules) != 1 || len(expert.Connectors) != 1 || len(expert.Warnings) != 3 {
		t.Fatalf("可用依赖应保留，缺失依赖应提示并跳过: %+v", expert)
	}
	items, err := desiredItems(resources, Options{}, nil, context.Background(), nil)
	if err != nil || len(items) != 4 {
		t.Fatalf("宽松解析结果应能进入导入计划: %v", err)
	}
	if _, err := pkg.AvatarBytes(expert); err != nil {
		t.Fatal(err)
	}
}

func TestRejectInvalidResourceJSON(t *testing.T) {
	data := packageFixture(t, func(m *Manifest, files map[string][]byte) {
		files["rule.json"] = []byte(`{"content":`)
		m.AgentResources.Rules = []Entry{{Slug: "rule", Path: "rule.json"}}
	})
	pkg, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseResources(pkg); err == nil {
		t.Fatal("资源 JSON 语法错误应被拒绝")
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
	if len(pkg.Files) != 2 {
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

func TestStaticAssetsIgnored(t *testing.T) {
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

func TestImportDuplicateSlugAcrossTypes(t *testing.T) {
	data := packageFixture(t, func(m *Manifest, files map[string][]byte) {
		rule := []byte(`{"slug":"demo-skill","name":"Rule","content":"example"}`)
		files["agent/rules/rule.json"] = rule
		m.AgentResources.Rules = []Entry{{Type: "rule", Slug: "demo-skill", Name: "Rule", Path: "agent/rules/rule.json", SHA256: digest(rule)}}
	})
	pkg, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	resources, err := ParseResources(pkg)
	if err != nil || len(resources.Skills) != 1 || len(resources.Rules) != 1 {
		t.Fatalf("跨类型同名资源应能分别导入: %v", err)
	}
	if _, ok := resources.Rules["demo-skill-rule-2"]; !ok {
		t.Fatal("跨类型同 slug 应自动补充唯一名称")
	}
}
