package designcatalog

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"unicode/utf8"
)

const MaxPackage int64 = 2 << 30
const MaxExpanded int64 = 4 << 30

func SafePath(name string) bool {
	return name != "" && utf8.ValidString(name) && !strings.ContainsAny(name, "\\\x00\r\n:") && !strings.HasPrefix(name, "/") && path.Clean(name) == name && name != "." && !strings.HasPrefix(name, "../") && name != ".." && !strings.Contains(name, "//") && !strings.HasSuffix(name, "/")
}

type archive struct{ files map[string]*zip.File }

func openArchive(reader io.ReaderAt, size int64) (*archive, error) {
	z, err := zip.NewReader(reader, size)
	if err != nil {
		return nil, fmt.Errorf("ZIP 无效: %w", err)
	}
	a := &archive{files: map[string]*zip.File{}}
	seen := map[string]bool{}
	var total uint64
	for _, f := range z.File {
		name := strings.TrimSuffix(f.Name, "/")
		if !SafePath(name) || f.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("不安全 ZIP 路径: %q", f.Name)
		}
		if _, ok := seen[name]; ok {
			return nil, fmt.Errorf("重复 ZIP 条目: %s", name)
		}
		seen[name] = !f.FileInfo().IsDir()
		if f.FileInfo().IsDir() {
			continue
		}
		if !f.Mode().IsRegular() || f.UncompressedSize64 > uint64(MaxExpanded) || total > uint64(MaxExpanded)-f.UncompressedSize64 {
			return nil, errors.New("ZIP 文件类型或展开大小超限")
		}
		total += f.UncompressedSize64
		a.files[name] = f
	}
	for name := range seen {
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			if seen[parent] {
				return nil, fmt.Errorf("ZIP 文件/目录前缀冲突: %s", name)
			}
		}
	}
	return a, nil
}

type parser struct {
	ctx   context.Context
	p     *Package
	bytes int64
}

func (r *parser) copy(dst io.Writer, f *zip.File) (int64, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	if f == nil {
		return 0, errors.New("缺少归档文件")
	}
	src, err := f.Open()
	if err != nil {
		return 0, err
	}
	defer src.Close()
	remaining := MaxExpanded - r.bytes
	if remaining < 0 {
		return 0, errors.New("累计展开大小超限")
	}
	var n int64
	buf := make([]byte, 64<<10)
	for {
		if err := r.ctx.Err(); err != nil {
			return n, err
		}
		read, e := src.Read(buf)
		if read > 0 {
			if int64(read) > remaining-n {
				return n, errors.New("累计展开大小超限")
			}
			w, writeErr := dst.Write(buf[:read])
			n += int64(w)
			r.bytes += int64(w)
			if writeErr != nil {
				return n, writeErr
			}
			if w != read {
				return n, io.ErrShortWrite
			}
		}
		if e == io.EOF {
			break
		}
		if e != nil {
			return n, e
		}
	}
	if uint64(n) != f.UncompressedSize64 {
		return n, errors.New("ZIP 文件声明大小不符")
	}
	return n, nil
}
func (r *parser) read(a *archive, name string) ([]byte, error) {
	f := a.files[name]
	if f == nil {
		return nil, fmt.Errorf("缺少文件: %s", name)
	}
	var b bytes.Buffer
	_, err := r.copy(&b, f)
	return b.Bytes(), err
}
func (r *parser) capture(f *zip.File) (string, int64, error) {
	file, err := os.CreateTemp(r.p.dir, "source-")
	if err != nil {
		return "", 0, err
	}
	defer file.Close()
	h := sha256.New()
	size, err := r.copy(io.MultiWriter(file, h), f)
	if err != nil {
		return "", 0, err
	}
	sha := "sha256:" + hex.EncodeToString(h.Sum(nil))
	if old := r.p.objects[sha]; old != "" {
		err = os.Remove(file.Name())
	} else {
		target := r.p.objectPath(sha)
		err = os.Rename(file.Name(), target)
		if err == nil {
			r.p.objects[sha] = target
		}
	}
	return sha, size, err
}
func ParseFile(ctx context.Context, name string) (*Package, error) {
	f, err := os.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return nil, err
	}
	return Parse(ctx, f, stat.Size())
}
func Parse(ctx context.Context, reader io.ReaderAt, size int64) (_ *Package, err error) {
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if size <= 0 || size > MaxPackage {
		return nil, errors.New("资源包大小超限")
	}
	outer, err := openArchive(reader, size)
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "monkeyai-design-*")
	if err != nil {
		return nil, err
	}
	p := &Package{dir: dir, objects: map[string]string{}}
	defer func() {
		if err != nil {
			_ = p.Close()
		}
	}()
	r := &parser{ctx: ctx, p: p}
	checks, err := r.read(outer, "CHECKSUMS.sha256")
	if err != nil {
		return nil, err
	}
	sums := map[string]string{}
	last := ""
	for _, line := range strings.Split(strings.TrimSuffix(string(checks), "\n"), "\n") {
		fields := strings.SplitN(line, "  ", 2)
		if len(fields) != 2 || !validHash("sha256:"+fields[0]) || !SafePath(fields[1]) || fields[1] == "CHECKSUMS.sha256" {
			return nil, errors.New("CHECKSUMS 格式无效")
		}
		if _, ok := sums[fields[1]]; ok || last != "" && fields[1] <= last {
			return nil, errors.New("CHECKSUMS 路径重复或顺序无效")
		}
		last = fields[1]
		sums[fields[1]] = fields[0]
	}
	if len(sums) != len(outer.files)-1 {
		return nil, errors.New("CHECKSUMS 覆盖范围不完整")
	}
	for name, f := range outer.files {
		if name == "CHECKSUMS.sha256" {
			continue
		}
		want, ok := sums[name]
		if !ok {
			return nil, fmt.Errorf("CHECKSUMS 遗漏 %s", name)
		}
		h := sha256.New()
		if _, err = r.copy(h, f); err != nil {
			return nil, fmt.Errorf("校验 %s: %w", name, err)
		}
		if hex.EncodeToString(h.Sum(nil)) != want {
			return nil, fmt.Errorf("文件 SHA 不符: %s", name)
		}
	}
	releaseRaw, err := r.read(outer, "release.json")
	if err != nil {
		return nil, err
	}
	manifestRaw, err := r.read(outer, "manifest.json")
	if err != nil {
		return nil, err
	}
	var rel Release
	var manifest Manifest
	if err = decode(releaseRaw, &rel); err != nil {
		return nil, err
	}
	if err = decode(manifestRaw, &manifest); err != nil {
		return nil, err
	}
	d := manifest.DesignResources
	if d.SchemaVersion != SchemaVersion || d.DigestSchema != DigestSchema {
		return nil, errors.New("unsupported_design_section: 不支持设计分区版本")
	}
	if rel.Publisher.ID == "" || rel.Publisher.ID != manifest.PublisherID || rel.ReleaseID == "" || rel.ReleaseID != manifest.ReleaseID || rel.Version != manifest.Version {
		return nil, errors.New("发布者或 release 身份不一致")
	}
	declared, err := ManifestDigest(manifestRaw)
	if err != nil {
		return nil, err
	}
	if declared != manifest.ManifestSHA256 || declared != rel.ManifestSHA256 {
		return nil, errors.New("manifest 投影摘要不符")
	}
	raw, err := r.read(outer, "design/catalog.json")
	if err != nil {
		return nil, err
	}
	var catalog Catalog
	if err = decode(raw, &catalog); err != nil {
		return nil, err
	}
	for _, entry := range catalog.Resources {
		if entry.Native != nil || entry.SourceSkillPath != nil || len(entry.Export) > 0 {
			return nil, errors.New("catalog 不得注入服务端派生字段")
		}
	}
	p.SnapshotRef = catalog.SnapshotRef
	p.Entries = catalog.Resources
	p.Taxonomy = catalog.Taxonomy
	if p.PublisherID != rel.Publisher.ID || p.ReleaseID != rel.ReleaseID || p.SchemaVersion != SchemaVersion || p.DigestSchema != DigestSchema || catalog.Revision != "" || p.Entries == nil {
		return nil, errors.New("catalog 快照身份无效")
	}
	raw, err = r.read(outer, "design/taxonomy.json")
	if err != nil {
		return nil, err
	}
	var taxonomy Taxonomy
	if err = decode(raw, &taxonomy); err != nil {
		return nil, err
	}
	a, _ := canonicalHash(taxonomy)
	b, _ := canonicalHash(p.Taxonomy)
	if a != b {
		return nil, errors.New("taxonomy 不一致")
	}
	if err = validateTaxonomy(p.Taxonomy, p.Entries); err != nil {
		return nil, err
	}
	if d.Taxonomy == nil || d.Taxonomy.Path != "design/taxonomy.json" || d.Taxonomy.SHA256 != "sha256:"+sums[d.Taxonomy.Path] {
		return nil, errors.New("taxonomy 产物引用不符")
	}
	refs := map[string]ManifestEntry{}
	for kind, items := range map[string][]ManifestEntry{"template": d.Templates, "design-system": d.DesignSystems, "style": d.Styles, "direction": d.Directions} {
		for _, e := range items {
			key := kind + "\x00" + e.CatalogID
			if e.CatalogID == "" || !SafePath(e.Path) || e.Slug == "" || refs[key].CatalogID != "" || !validHash(e.ContentDigest) || e.SHA256 != "sha256:"+sums[e.Path] {
				return nil, errors.New("manifest 资源引用无效或重复")
			}
			refs[key] = e
		}
	}
	if len(refs) != len(p.Entries) {
		return nil, errors.New("manifest/catalog 资源数量不符")
	}
	seen := map[string]bool{}
	for i := range p.Entries {
		e := &p.Entries[i]
		key := e.Kind + "\x00" + e.ID
		ref, ok := refs[key]
		if !ok || seen[key] || e.ID == "" || e.ID == "." || e.ID == ".." || strings.ContainsAny(e.ID, "/\\\x00\r\n") || e.Artifact == nil || e.Artifact.Path != ref.Path || e.Artifact.SHA256 != ref.SHA256 || e.ContentDigest != ref.ContentDigest || e.Files == nil {
			return nil, errors.New("catalog 资源身份、引用或摘要不符")
		}
		seen[key] = true
		if err = validateProvenance(e.Provenance); err != nil {
			return nil, err
		}
		actual, err := ContentDigest(*e)
		if err != nil {
			return nil, fmt.Errorf("%s/%s: %w", e.Kind, e.ID, err)
		}
		if actual != e.ContentDigest {
			return nil, fmt.Errorf("业务摘要不符: %s/%s", e.Kind, e.ID)
		}
		if e.Kind == "template" || e.Kind == "design-system" {
			if err = r.nested(outer, e); err != nil {
				return nil, fmt.Errorf("%s/%s: %w", e.Kind, e.ID, err)
			}
		} else {
			e.Export, err = r.read(outer, ref.Path)
			if err != nil {
				return nil, err
			}
			var export map[string]json.RawMessage
			if err = decode(e.Export, &export); err != nil {
				return nil, err
			}
			for _, f := range e.Files {
				if e.Kind != "style" {
					return nil, errors.New("方向不允许文件")
				}
				physical := "design/style-assets/" + ref.Slug + "/" + f.Path
				zf := outer.files[physical]
				if zf == nil {
					return nil, fmt.Errorf("缺少风格文件: %s", physical)
				}
				sha, size, err := r.capture(zf)
				if err != nil {
					return nil, err
				}
				if sha != f.SHA256 || size != f.Size {
					return nil, fmt.Errorf("风格源文件不符: %s", f.Path)
				}
			}
		}
	}
	return p, nil
}
func (r *parser) nested(outer *archive, e *Entry) error {
	file, err := os.CreateTemp(r.p.dir, "archive-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, err = r.copy(file, outer.files[e.Artifact.Path]); err != nil {
		return err
	}
	info, err := file.Stat()
	if err != nil {
		return err
	}
	nz, err := openArchive(file, info.Size())
	if err != nil {
		return err
	}
	name := "template.json"
	if e.Kind == "design-system" {
		name = "design-system.json"
	}
	raw, err := r.read(nz, name)
	if err != nil {
		return err
	}
	e.Export = raw
	var meta struct {
		ContentDigest string            `json:"content_digest"`
		Files         []FileRef         `json:"files"`
		Paths         map[string]string `json:"source_file_paths"`
		Refs          []struct {
			Source  string `json:"source_path"`
			Archive string `json:"archive_path"`
		} `json:"source_file_refs"`
		Body string `json:"body"`
	}
	if err = decode(raw, &meta); err != nil {
		return err
	}
	if meta.ContentDigest != "" && meta.ContentDigest != e.ContentDigest {
		return errors.New("嵌套资源摘要冲突")
	}
	if len(meta.Files) != len(e.Files) {
		return errors.New("嵌套 files 数量不符")
	}
	logical := map[string]FileRef{}
	for _, f := range e.Files {
		logical[f.Path] = f
	}
	seen := map[string]bool{}
	for _, f := range meta.Files {
		want, ok := logical[f.Path]
		if !ok || seen[f.Path] || f.SHA256 != want.SHA256 || f.Size != want.Size || f.MIME != want.MIME || f.Role != nil && (want.Role == nil || *f.Role != *want.Role) {
			return errors.New("嵌套 files 引用不符")
		}
		seen[f.Path] = true
	}
	mapping := meta.Paths
	if meta.Refs != nil {
		refs := map[string]string{}
		for _, ref := range meta.Refs {
			if _, ok := refs[ref.Source]; ok {
				return errors.New("重复源路径映射")
			}
			refs[ref.Source] = ref.Archive
		}
		if mapping != nil {
			a, _ := canonicalHash(mapping)
			b, _ := canonicalHash(refs)
			if a != b {
				return errors.New("两种源路径映射不一致")
			}
		} else {
			mapping = refs
		}
	}
	for source, target := range mapping {
		if !SafePath(source) || !SafePath(target) || nz.files[target] == nil {
			return errors.New("不安全或悬空源路径映射")
		}
		if _, ok := logical[source]; !ok {
			return errors.New("映射源不在 catalog files 中")
		}
		if strings.HasSuffix(target, "._source") && source != target {
			if _, occupied := logical[target]; occupied {
				return errors.New("源文件占用了避让目标")
			}
		}
	}
	captured := map[string]FileRef{}
	for _, want := range e.Files {
		physical := want.Path
		if target, ok := mapping[physical]; ok {
			physical = target
		}
		f := nz.files[physical]
		if f == nil {
			return fmt.Errorf("缺少源文件 %s", want.Path)
		}
		if physical == name || e.Kind == "design-system" && physical == meta.Body {
			if _, mapped := mapping[want.Path]; !mapped {
				return errors.New("源文件引用了发布层元数据")
			}
		}
		actual, ok := captured[physical]
		if !ok {
			sha, size, err := r.capture(f)
			if err != nil {
				return err
			}
			actual = FileRef{SHA256: sha, Size: size}
			captured[physical] = actual
		}
		if actual.SHA256 != want.SHA256 || actual.Size != want.Size {
			return fmt.Errorf("源文件 SHA/size 不符: %s", want.Path)
		}
	}
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(e.Metadata, &fields)
	var export map[string]json.RawMessage
	_ = json.Unmarshal(raw, &export)
	if e.Kind == "design-system" {
		body, err := r.read(nz, meta.Body)
		if err != nil {
			return err
		}
		if string(body) != stringValue(fields["content"]) {
			return errors.New("系统正文不符")
		}
	} else {
		for _, pair := range [][2]string{{"localized_prompt", "localizedPrompt"}, {"localized_description", "localizedDescription"}, {"example_prompt", "examplePrompt"}} {
			b := export[pair[0]]
			if len(b) == 0 {
				continue
			}
			if b[0] == '{' {
				var paths map[string]string
				if err = decode(b, &paths); err != nil {
					return err
				}
				texts := map[string]string{}
				for lang, p := range paths {
					if !SafePath(p) {
						return errors.New("提示词引用路径不安全")
					}
					text, err := r.read(nz, p)
					if err != nil {
						return err
					}
					texts[lang] = string(text)
				}
				a, _ := canonicalHash(texts)
				want, err := Canonical(fields[pair[1]])
				if err != nil || a != Hash(want) {
					return errors.New("外置提示词不符")
				}
			} else {
				p := stringValue(b)
				text := ""
				if p != "" {
					if !SafePath(p) {
						return errors.New("提示词路径不安全")
					}
					data, err := r.read(nz, p)
					if err != nil {
						return err
					}
					text = string(data)
				}
				if text != stringValue(fields[pair[1]]) {
					return errors.New("外置文本不符")
				}
			}
		}
		if boolValue(fields["has_skill"]) {
			skill := stringValue(fields["skillPath"])
			if _, ok := logical[skill]; ok {
				e.SourceSkillPath = new(skill)
			} else {
				matches := []string{}
				for source, target := range mapping {
					if target == skill {
						matches = append(matches, source)
					}
				}
				if len(matches) != 1 {
					return errors.New("技能路径缺失或映射歧义")
				}
				e.SourceSkillPath = new(matches[0])
			}
		}
	}
	for physical, f := range nz.files {
		if _, ok := captured[physical]; !ok {
			if _, err := r.copy(io.Discard, f); err != nil {
				return fmt.Errorf("嵌套条目损坏 %s: %w", physical, err)
			}
		}
	}
	return nil
}
func validateTaxonomy(t Taxonomy, entries []Entry) error {
	if t.Modes == nil || t.Categories == nil || t.ModeCategories == nil || t.ResourceCategories == nil {
		return errors.New("taxonomy 数组不得缺省或 null")
	}
	modes := map[string]bool{}
	categories := map[string]bool{}
	for _, group := range []struct {
		terms []Term
		keys  map[string]bool
	}{{t.Modes, modes}, {t.Categories, categories}} {
		for _, term := range group.terms {
			if err := validateProvenance(term.Provenance); err != nil {
				return err
			}
			if term.ID == "" || term.Count < 0 || term.LocalizedName == nil || group.keys[term.ID] {
				return errors.New("taxonomy 词条无效或重复")
			}
			group.keys[term.ID] = true
		}
	}
	parents := map[string]string{}
	for _, term := range t.Categories {
		if term.ParentID != "" && !categories[term.ParentID] {
			return errors.New("taxonomy 父分类不存在")
		}
		parents[term.ID] = term.ParentID
	}
	for id := range parents {
		seen := map[string]bool{}
		for id != "" {
			if seen[id] {
				return errors.New("taxonomy 分类循环")
			}
			seen[id] = true
			id = parents[id]
		}
	}
	seen := map[string]bool{}
	for _, rel := range t.ModeCategories {
		key := rel.ModeID + "\x00" + rel.CategoryID
		if !modes[rel.ModeID] || !categories[rel.CategoryID] || seen[key] {
			return errors.New("taxonomy mode/category 关系无效")
		}
		seen[key] = true
	}
	ids := map[string]bool{}
	for _, e := range entries {
		ids[e.Kind+"\x00"+e.ID] = true
	}
	clear(seen)
	for _, rel := range t.ResourceCategories {
		key := rel.Kind + "\x00" + rel.ID + "\x00" + rel.ModeID + "\x00" + rel.CategoryID
		if rel.Kind != "template" || !ids[rel.Kind+"\x00"+rel.ID] || !modes[rel.ModeID] || !categories[rel.CategoryID] || seen[key] {
			return errors.New("taxonomy 资源关系无效")
		}
		seen[key] = true
	}
	return nil
}
