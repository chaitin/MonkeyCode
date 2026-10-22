package designcatalog

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"slices"
	"strings"
	"testing"
)

func unpack(t *testing.T, raw []byte) map[string][]byte {
	t.Helper()
	z, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string][]byte{}
	for _, f := range z.File {
		r, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		out[f.Name], err = io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	return out
}
func pack(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	names := []string{}
	for name := range files {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		w, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = w.Write(files[name]); err != nil {
			t.Fatal(err)
		}
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
func jsonBytes(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func jsonMap(t *testing.T, b []byte) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func seal(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var manifest map[string]any
	_ = json.Unmarshal(files["manifest.json"], &manifest)
	catalog := jsonMap(t, files["design/catalog.json"])
	for _, entry := range catalog["resources"].([]any) {
		e := entry.(map[string]any)
		a := e["artifact"].(map[string]any)
		name := a["path"].(string)
		a["sha256"] = Hash(files[name])
	}
	for _, group := range []string{"templates", "design_systems", "styles", "directions"} {
		for _, entry := range manifest["design_resources"].(map[string]any)[group].([]any) {
			e := entry.(map[string]any)
			e["sha256"] = Hash(files[e["path"].(string)])
		}
	}
	files["design/catalog.json"] = jsonBytes(t, catalog)
	files["manifest.json"] = jsonBytes(t, manifest)
	h, err := ManifestDigest(files["manifest.json"])
	if err != nil {
		t.Fatal(err)
	}
	manifest["manifest_sha256"] = h
	files["manifest.json"] = jsonBytes(t, manifest)
	release := jsonMap(t, files["release.json"])
	release["manifest_sha256"] = h
	files["release.json"] = jsonBytes(t, release)
	names := []string{}
	for name := range files {
		if name != "CHECKSUMS.sha256" {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	var checks strings.Builder
	for _, name := range names {
		h := sha256.Sum256(files[name])
		checks.WriteString(hex.EncodeToString(h[:]) + "  " + name + "\n")
	}
	files["CHECKSUMS.sha256"] = []byte(checks.String())
	return pack(t, files)
}
func TestDesignPackageRejectsCorruption(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/design-contract/v1/release.zip")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, want string
		mutate     func(map[string][]byte)
	}{
		{"unsupported_schema", "unsupported_design_section", func(f map[string][]byte) {
			m := jsonMap(t, f["manifest.json"])
			m["design_resources"].(map[string]any)["schema_version"] = 2
			f["manifest.json"] = jsonBytes(t, m)
		}},
		{"publisher_mismatch", "发布者", func(f map[string][]byte) {
			m := jsonMap(t, f["release.json"])
			m["publisher"].(map[string]any)["id"] = "other"
			f["release.json"] = jsonBytes(t, m)
		}},
		{"derived_fields", "派生字段", func(f map[string][]byte) {
			c := jsonMap(t, f["design/catalog.json"])
			c["resources"].([]any)[0].(map[string]any)["native"] = map[string]any{"key": "private/object", "sha256": Hash([]byte("x")), "size": 1}
			f["design/catalog.json"] = jsonBytes(t, c)
		}},
		{"wrong_digest", "业务摘要", func(f map[string][]byte) {
			c := jsonMap(t, f["design/catalog.json"])
			c["resources"].([]any)[0].(map[string]any)["metadata"].(map[string]any)["name"] = "changed"
			f["design/catalog.json"] = jsonBytes(t, c)
		}},
		{"duplicate_id", "资源身份", func(f map[string][]byte) {
			c := jsonMap(t, f["design/catalog.json"])
			a := c["resources"].([]any)
			a[1] = a[0]
			f["design/catalog.json"] = jsonBytes(t, c)
		}},
		{"unsafe_mapping", "映射", func(f map[string][]byte) {
			n := unpack(t, f["design/templates/sample.bundle.zip"])
			m := jsonMap(t, n["template.json"])
			delete(m, "source_file_refs")
			m["source_file_paths"].(map[string]any)["wrap/SKILL.md"] = "../escape"
			n["template.json"] = jsonBytes(t, m)
			f["design/templates/sample.bundle.zip"] = pack(t, n)
		}},
		{"mapping_disagreement", "不一致", func(f map[string][]byte) {
			n := unpack(t, f["design/templates/sample.bundle.zip"])
			m := jsonMap(t, n["template.json"])
			m["source_file_paths"].(map[string]any)["wrap/SKILL.md"] = "ordinary._source"
			n["template.json"] = jsonBytes(t, m)
			f["design/templates/sample.bundle.zip"] = pack(t, n)
		}},
		{"source_sha", "SHA/size", func(f map[string][]byte) {
			n := unpack(t, f["design/templates/sample.bundle.zip"])
			n["assets/shared.txt"] = []byte("changed\n")
			f["design/templates/sample.bundle.zip"] = pack(t, n)
		}},
		{"explicit_role_conflict", "files 引用", func(f map[string][]byte) {
			n := unpack(t, f["design/templates/sample.bundle.zip"])
			m := jsonMap(t, n["template.json"])
			m["files"].([]any)[0].(map[string]any)["role"] = "wrong"
			n["template.json"] = jsonBytes(t, m)
			f["design/templates/sample.bundle.zip"] = pack(t, n)
		}},
		{"nested_digest", "嵌套资源摘要", func(f map[string][]byte) {
			n := unpack(t, f["design/templates/sample.bundle.zip"])
			m := jsonMap(t, n["template.json"])
			m["content_digest"] = Hash([]byte("wrong"))
			n["template.json"] = jsonBytes(t, m)
			f["design/templates/sample.bundle.zip"] = pack(t, n)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := unpack(t, raw)
			tc.mutate(f)
			b := seal(t, f)
			p, err := Parse(t.Context(), bytes.NewReader(b), int64(len(b)))
			if err == nil {
				p.Close()
				t.Fatal("损坏包被接受")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("未命中预期校验 %q: %v", tc.want, err)
			}
		})
	}
	f := unpack(t, raw)
	f["design/templates/sample.bundle.zip"] = []byte("corrupted")
	b := pack(t, f)
	if p, err := Parse(t.Context(), bytes.NewReader(b), int64(len(b))); err == nil {
		p.Close()
		t.Fatal("外包 SHA 损坏未拒绝")
	}
}
func TestLogicalSourceSafety(t *testing.T) {
	d := fixture(t)
	e := *d.Entry("template", "sample.bundle")
	e.Files = append([]FileRef(nil), e.Files...)
	e.Files[0].Role = nil
	absent, err := ContentDigest(e)
	if err != nil {
		t.Fatal(err)
	}
	e.Files[0].Role = new("")
	empty, err := ContentDigest(e)
	if err != nil || absent == empty {
		t.Fatal("role缺省与空值未区分", err)
	}
	before, err := d.Digest()
	if err != nil {
		t.Fatal(err)
	}
	d.Entries[0].Provenance = json.RawMessage(`null`)
	after, err := d.Digest()
	if err != nil || before == after {
		t.Fatal("provenance缺省与显式null未区分", err)
	}
	p := fixture(t)
	e = *p.Entry("template", "sample.bundle")
	sha := Hash([]byte("x"))
	for _, files := range [][]FileRef{
		{{Path: "a", SHA256: sha, Size: 1, MIME: "text/plain"}, {Path: "a/b", SHA256: sha, Size: 1, MIME: "text/plain"}},
		{{Path: "a", SHA256: sha, Size: 1, MIME: "image/png\r\nX-Injected: yes"}},
	} {
		e.Files = files
		if _, err := ContentDigest(e); err == nil {
			t.Fatal("不安全逻辑源文件被接受")
		}
	}
}

func TestUnsafeZIP(t *testing.T) {
	for _, names := range [][]string{{"../escape"}, {"a", "a"}, {"a", "a/b"}, {"a/b", "a"}, {"a//b"}, {"a\\b"}} {
		var buf bytes.Buffer
		z := zip.NewWriter(&buf)
		for _, n := range names {
			w, _ := z.Create(n)
			w.Write([]byte("x"))
		}
		z.Close()
		if _, err := openArchive(bytes.NewReader(buf.Bytes()), int64(buf.Len()), MaxExpanded); err == nil {
			t.Fatalf("不安全 ZIP 被接受: %v", names)
		}
	}
}
