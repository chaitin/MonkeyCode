package resourceimport

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"regexp"
	"slices"
	"strings"
	"time"
)

const (
	MaxPackage        = 2 << 30
	MaxExpanded       = 4 << 30
	MaxFiles          = 5000
	MaxFile           = MaxPackage
	MaxMetadata       = 8 << 20
	MaxExpertPackage  = 100 << 20
	MaxExpertExpanded = 200 << 20
	MaxRetainedText   = 256 << 20
)

var slugPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$`)
var shaPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

type Publisher struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	URL     string `json:"url"`
}

type Release struct {
	Publisher      Publisher      `json:"publisher"`
	ReleaseID      string         `json:"release_id"`
	Version        int64          `json:"version"`
	PublishedAt    time.Time      `json:"published_at"`
	ExportedAt     time.Time      `json:"exported_at"`
	ManifestSHA256 string         `json:"manifest_sha256"`
	Counts         map[string]int `json:"counts"`
}

type Entry struct {
	Type            string            `json:"type"`
	Slug            string            `json:"slug"`
	Name            string            `json:"name"`
	Tags            []string          `json:"tags,omitempty"`
	Path            string            `json:"path"`
	SHA256          string            `json:"sha256"`
	NameI18n        map[string]string `json:"name_i18n,omitempty"`
	DescriptionI18n map[string]string `json:"description_i18n,omitempty"`
}

type AgentResources struct {
	Skills     []Entry `json:"skills"`
	Rules      []Entry `json:"rules"`
	Connectors []Entry `json:"connectors"`
	Experts    []Entry `json:"experts"`
}

type DesignResources struct {
	Templates     []json.RawMessage `json:"templates"`
	DesignSystems []json.RawMessage `json:"design_systems"`
	Styles        []json.RawMessage `json:"styles"`
	Directions    []json.RawMessage `json:"directions"`
}

func (d DesignResources) Empty() bool {
	return len(d.Templates)+len(d.DesignSystems)+len(d.Styles)+len(d.Directions) == 0
}

type Asset struct {
	Slug     string `json:"slug"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	MIME     string `json:"mime"`
	Hash     string `json:"hash"`
	Size     int64  `json:"size"`
	Download string `json:"download"`
}

type Manifest struct {
	ReleaseID       string          `json:"release_id"`
	Version         int64           `json:"version"`
	ManifestSHA256  string          `json:"manifest_sha256"`
	GeneratedAt     time.Time       `json:"generated_at"`
	AgentResources  AgentResources  `json:"agent_resources"`
	DesignResources DesignResources `json:"design_resources"`
	StaticAssets    []Asset         `json:"static_assets"`
}

type Package struct {
	Release  Release
	Manifest Manifest
	Files    map[string][]byte
	entries  map[string]*zip.File
	streamed bool
}

func (p Package) Names() []string {
	names := make([]string, 0, len(p.entries))
	for name := range p.entries {
		names = append(names, name)
	}
	return names
}

func (p Package) ReadFile(name string) ([]byte, error) {
	if data, ok := p.Files[name]; ok {
		return data, nil
	}
	entry := p.entries[name]
	if entry == nil {
		return nil, fmt.Errorf("资源包中缺少文件: %s", name)
	}
	reader, err := entry.Open()
	if err != nil {
		return nil, err
	}
	data, readErr := io.ReadAll(io.LimitReader(reader, int64(entry.UncompressedSize64)+1))
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil || uint64(len(data)) != entry.UncompressedSize64 {
		return nil, fmt.Errorf("资源包中文件损坏: %s", name)
	}
	return data, nil
}

func digest(data []byte) string {
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func safePath(name string) bool {
	return name != "" && !strings.ContainsAny(name, "\\\x00:") && !strings.HasPrefix(name, "/") &&
		!strings.HasPrefix(name, "../") && name != ".." && path.Clean(name) == name &&
		!strings.Contains(name, "//") && !strings.ContainsAny(name, "\r\n")
}

func readZIP(data []byte, maxSize, maxExpanded, maxFiles, maxFile int) (map[string][]byte, error) {
	if len(data) == 0 || len(data) > maxSize {
		return nil, fmt.Errorf("压缩包大小超限")
	}
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(z.File) > maxFiles {
		return nil, fmt.Errorf("ZIP 无效或条目数超限")
	}
	files := make(map[string][]byte, len(z.File))
	seen := make(map[string]bool, len(z.File))
	total := 0
	for _, f := range z.File {
		name := strings.TrimSuffix(f.Name, "/")
		if !safePath(name) || seen[strings.ToLower(name)] || f.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("ZIP 存在不安全或重复路径: %q", f.Name)
		}
		seen[strings.ToLower(name)] = true
		if f.FileInfo().IsDir() {
			if !strings.HasSuffix(f.Name, "/") {
				return nil, fmt.Errorf("ZIP 目录路径无效: %q", f.Name)
			}
			continue
		}
		if !f.Mode().IsRegular() || f.UncompressedSize64 > uint64(maxFile) {
			return nil, fmt.Errorf("ZIP 文件类型或大小无效: %q", name)
		}
		reader, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("打开 ZIP 文件 %q: %w", name, err)
		}
		limit := min(maxFile, maxExpanded-total)
		if limit < 0 {
			reader.Close()
			return nil, fmt.Errorf("ZIP 解压大小超限")
		}
		content, readErr := io.ReadAll(io.LimitReader(reader, int64(limit)+1))
		closeErr := reader.Close()
		if readErr != nil || closeErr != nil || len(content) > limit || uint64(len(content)) != f.UncompressedSize64 {
			return nil, fmt.Errorf("ZIP 文件损坏或解压大小超限: %q", name)
		}
		total += len(content)
		files[name] = content
	}
	return files, nil
}

func canonicalManifest(m Manifest) ([]byte, error) {
	return json.Marshal(struct {
		ReleaseID       string          `json:"release_id"`
		Version         int64           `json:"version"`
		GeneratedAt     time.Time       `json:"generated_at"`
		AgentResources  AgentResources  `json:"agent_resources"`
		DesignResources DesignResources `json:"design_resources"`
		StaticAssets    []Asset         `json:"static_assets"`
	}{m.ReleaseID, m.Version, m.GeneratedAt, m.AgentResources, m.DesignResources, m.StaticAssets})
}

func checkSums(p Package) error {
	data, err := p.ReadFile("CHECKSUMS.sha256")
	if err != nil {
		return err
	}
	lines := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
	if len(lines) != len(p.entries)-2 {
		return fmt.Errorf("CHECKSUMS.sha256 条目数量不符")
	}
	paths := make([]string, 0, len(p.entries)-2)
	for name := range p.entries {
		if name != "release.json" && name != "CHECKSUMS.sha256" {
			paths = append(paths, name)
		}
	}
	slices.Sort(paths)
	for i, name := range paths {
		entry := p.entries[name]
		reader, openErr := entry.Open()
		if openErr != nil {
			return fmt.Errorf("打开资源文件 %s: %w", name, openErr)
		}
		hash := sha256.New()
		length, readErr := io.Copy(hash, io.LimitReader(reader, int64(entry.UncompressedSize64)+1))
		closeErr := reader.Close()
		if readErr != nil || closeErr != nil || length != int64(entry.UncompressedSize64) ||
			lines[i] != hex.EncodeToString(hash.Sum(nil))+"  "+name {
			return fmt.Errorf("CHECKSUMS.sha256 校验失败: %s", name)
		}
	}
	return nil
}

func Parse(data []byte) (Package, error) {
	p, err := ParseReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return p, err
	}
	for name := range p.entries {
		p.Files[name], err = p.ReadFile(name)
		if err != nil {
			return Package{}, err
		}
	}
	p.streamed = false
	return p, nil
}

func ParseReader(reader io.ReaderAt, size int64) (Package, error) {
	p := Package{Files: map[string][]byte{}, entries: map[string]*zip.File{}, streamed: true}
	if size <= 0 || size > MaxPackage {
		return p, fmt.Errorf("压缩包大小超限")
	}
	z, err := zip.NewReader(reader, size)
	if err != nil || len(z.File) > MaxFiles {
		return p, fmt.Errorf("ZIP 无效或条目数超限")
	}
	seen := make(map[string]bool, len(z.File))
	var total uint64
	for _, f := range z.File {
		name := strings.TrimSuffix(f.Name, "/")
		if !safePath(name) || seen[strings.ToLower(name)] || f.Mode()&os.ModeSymlink != 0 {
			return Package{}, fmt.Errorf("ZIP 存在不安全或重复路径: %q", f.Name)
		}
		seen[strings.ToLower(name)] = true
		if f.FileInfo().IsDir() {
			if !strings.HasSuffix(f.Name, "/") {
				return Package{}, fmt.Errorf("ZIP 目录路径无效: %q", f.Name)
			}
			continue
		}
		limit := uint64(MaxFile)
		if name == "release.json" || name == "manifest.json" || name == "CHECKSUMS.sha256" {
			limit = MaxMetadata
		}
		if !f.Mode().IsRegular() || f.UncompressedSize64 > limit || f.UncompressedSize64 > uint64(MaxExpanded)-total {
			return Package{}, fmt.Errorf("ZIP 文件类型或解压大小无效: %q", name)
		}
		total += f.UncompressedSize64
		p.entries[name] = f
	}
	for _, name := range []string{"release.json", "manifest.json", "CHECKSUMS.sha256"} {
		if p.entries[name] == nil || p.entries[name].UncompressedSize64 == 0 {
			return p, fmt.Errorf("缺少 %s", name)
		}
		p.Files[name], err = p.ReadFile(name)
		if err != nil {
			return Package{}, err
		}
	}
	if err = checkSums(p); err != nil {
		return p, err
	}
	if err = json.Unmarshal(p.Files["release.json"], &p.Release); err != nil {
		return p, fmt.Errorf("release.json 无效: %w", err)
	}
	if err = json.Unmarshal(p.Files["manifest.json"], &p.Manifest); err != nil {
		return p, fmt.Errorf("manifest.json 无效: %w", err)
	}
	m := p.Manifest
	if strings.TrimSpace(p.Release.Publisher.Name) != p.Release.Publisher.Name || p.Release.Publisher.Name == "" || len(p.Release.Publisher.Name) > 128 || m.Version < 1 ||
		m.ReleaseID == "" || m.ReleaseID != p.Release.ReleaseID || m.Version != p.Release.Version ||
		!shaPattern.MatchString(m.ManifestSHA256) || m.ManifestSHA256 != p.Release.ManifestSHA256 {
		return Package{}, fmt.Errorf("发布包身份或版本无效")
	}
	canonical, err := canonicalManifest(m)
	if err != nil || digest(canonical) != m.ManifestSHA256 {
		return Package{}, fmt.Errorf("manifest 规范化摘要无效")
	}
	if !m.DesignResources.Empty() {
		return Package{}, fmt.Errorf("本期不支持设计资源")
	}
	sections := []struct {
		kind, directory string
		items           []Entry
	}{{"skill", "skills", m.AgentResources.Skills}, {"rule", "rules", m.AgentResources.Rules},
		{"connector", "connectors", m.AgentResources.Connectors}, {"expert", "experts", m.AgentResources.Experts}}
	seenSlugs := map[string]bool{}
	referenced := map[string]bool{"manifest.json": true}
	for _, section := range sections {
		maxArtifact := uint64(MaxFile)
		switch section.kind {
		case "skill":
			maxArtifact = 20 << 20
		case "expert":
			maxArtifact = MaxExpertPackage
		case "rule":
			maxArtifact = 2 << 20
		case "connector":
			maxArtifact = 1 << 20
		}
		for _, entry := range section.items {
			file := p.entries[entry.Path]
			if entry.Type != section.kind || !slugPattern.MatchString(entry.Slug) || seenSlugs[entry.Slug] ||
				strings.TrimSpace(entry.Name) == "" || len(entry.Name) > 200 ||
				!safePath(entry.Path) || !strings.HasPrefix(entry.Path, "agent/"+section.directory+"/") ||
				!shaPattern.MatchString(entry.SHA256) || referenced[entry.Path] || file == nil || file.UncompressedSize64 == 0 || file.UncompressedSize64 > maxArtifact {
				return Package{}, fmt.Errorf("%s 资源路径、slug 或摘要无效: %q", section.kind, entry.Slug)
			}
			seenSlugs[entry.Slug], referenced[entry.Path] = true, true
		}
	}
	for _, asset := range m.StaticAssets {
		if !slugPattern.MatchString(asset.Slug) || asset.Size < 0 || asset.Size > MaxFile || asset.Name == "" || asset.Download == "" {
			return Package{}, fmt.Errorf("静态资源清单无效: %s", asset.Slug)
		}
		prefix, count := "static/"+asset.Slug+"/", 0
		for name, file := range p.entries {
			if strings.HasPrefix(name, prefix) {
				if referenced[name] || file.UncompressedSize64 != uint64(asset.Size) {
					return Package{}, fmt.Errorf("静态资源文件无效: %s", name)
				}
				referenced[name] = true
				count++
			}
		}
		if count != 1 {
			return Package{}, fmt.Errorf("静态资源应恰有一个文件: %s", asset.Slug)
		}
	}
	for name := range p.entries {
		if name != "release.json" && name != "CHECKSUMS.sha256" && !referenced[name] {
			return Package{}, fmt.Errorf("发布包包含未声明的文件: %s", name)
		}
	}
	return p, nil
}
