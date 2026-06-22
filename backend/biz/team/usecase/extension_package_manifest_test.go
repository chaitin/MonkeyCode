package usecase

import (
	"archive/zip"
	"bytes"
	"testing"
)

func TestParseExtensionPackageRejectsDuplicateImageArch(t *testing.T) {
	data := makeExtensionZip(t, map[string]string{
		"manifest.json": `{
			"package_id":"pack",
			"version":"1.0.0",
			"images":[{"image_id":"devbox","name":"repo/devbox:1","archives":[
				{"arch":"x86_64","archive":"images/devbox.tar.gz","sha256":""},
				{"arch":"x86_64","archive":"images/devbox2.tar.gz","sha256":""}
			]}]
		}`,
		"images/devbox.tar.gz":  "image",
		"images/devbox2.tar.gz": "image",
	})
	if _, err := parseExtensionPackage(data); err == nil {
		t.Fatal("parseExtensionPackage should reject duplicate arch")
	}
}

func TestParseExtensionPackageReadsSkillAndImageArchive(t *testing.T) {
	skill := "---\nname: reviewer\ndescription: Review code\ntags: [go, review]\n---\n"
	data := makeExtensionZip(t, map[string]string{
		"manifest.json": `{
			"package_id":"pack",
			"version":"1.0.0",
			"skills":[{"skill_id":"reviewer","path":"skills/reviewer/SKILL.md"}],
			"images":[{"image_id":"devbox","name":"repo/devbox:1","remark":"Devbox","archives":[
				{"arch":"x86_64","archive":"images/x86_64/devbox.tar.gz","sha256":""}
			]}]
		}`,
		"skills/reviewer/SKILL.md":    skill,
		"images/x86_64/devbox.tar.gz": "image",
	})
	pkg, err := parseExtensionPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	if pkg.PackageID != "pack" || pkg.Version != "1.0.0" {
		t.Fatalf("package = %#v", pkg)
	}
	if got := pkg.Skills[0].Name; got != "reviewer" {
		t.Fatalf("skill name = %q", got)
	}
	if got := pkg.Images[0].Archives[0].Arch; got != "x86_64" {
		t.Fatalf("archive arch = %q", got)
	}
}

func TestParseExtensionPackageReadsRules(t *testing.T) {
	data := makeExtensionZip(t, map[string]string{
		"manifest.json": `{
			"package_id":"pack",
			"version":"1.0.0",
			"rules":[{"rule_id":"codex-base","name":"codex-base","description":"base rule","path":"rules/codex-base.md"}]
		}`,
		"rules/codex-base.md": "# Codex Base\n",
	})

	pkg, err := parseExtensionPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(pkg.Rules) != 1 {
		t.Fatalf("rules = %#v", pkg.Rules)
	}
	if got := pkg.Rules[0].Content; got != "# Codex Base\n" {
		t.Fatalf("rule content = %q", got)
	}
	if got := pkg.Rules[0].Name; got != "codex-base" {
		t.Fatalf("rule name = %q", got)
	}
}

func TestParseExtensionPackageRejectsDuplicateRuleID(t *testing.T) {
	data := makeExtensionZip(t, map[string]string{
		"manifest.json": `{
			"package_id":"pack",
			"version":"1.0.0",
			"rules":[
				{"rule_id":"codex-base","name":"codex-base","path":"rules/a.md"},
				{"rule_id":"codex-base","name":"codex-other","path":"rules/b.md"}
			]
		}`,
		"rules/a.md": "a",
		"rules/b.md": "b",
	})
	if _, err := parseExtensionPackage(data); err == nil {
		t.Fatal("parseExtensionPackage should reject duplicate rule_id")
	}
}

func TestParseExtensionPackageRequiresAtLeastOneResource(t *testing.T) {
	data := makeExtensionZip(t, map[string]string{
		"manifest.json": `{"package_id":"pack","version":"1.0.0"}`,
	})
	if _, err := parseExtensionPackage(data); err == nil {
		t.Fatal("parseExtensionPackage should reject empty resources")
	}
}

func makeExtensionZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
