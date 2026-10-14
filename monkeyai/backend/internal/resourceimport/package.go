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
	"strings"
	"uuid"
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

type Publisher struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	URL     string `json:"url"`
}

type Release struct {
	Publisher      Publisher       `json:"publisher"`
	ReleaseID      string          `json:"release_id"`
	Version        int64           `json:"version"`
	PublishedAt    json.RawMessage `json:"published_at"`
	ExportedAt     json.RawMessage `json:"exported_at"`
	ManifestSHA256 string          `json:"manifest_sha256"`
	Counts         map[string]int  `json:"counts"`
}

type Entry struct {
	SourceSlug      string            `json:"-"`
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
	GeneratedAt     json.RawMessage `json:"generated_at"`
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

func decodeJSON(data []byte, out any) error {
	if !json.Valid(data) {
		return fmt.Errorf("JSON 格式无效")
	}
	// 字段类型不匹配时保留可读取的字段，其余使用导入默认值。
	_ = json.Unmarshal(data, out)
	return nil
}

func first(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func uniqueSlug(slug, kind string, used map[string]string) string {
	name := []rune(first(slug, kind))
	slug = string(name[:min(len(name), 128)])
	candidate := slug
	for n := 2; used[candidate] != ""; n++ {
		candidate = fmt.Sprintf("%s-%s-%d", string(name[:min(len(name), 100)]), kind, n)
	}
	used[candidate] = kind
	return candidate
}

func manifestID(data []byte) string {
	sum := sha256.Sum256(data)
	id := uuid.UUID(sum[:16])
	id[6] = id[6]&0x0f | 0x80
	id[8] = id[8]&0x3f | 0x80
	return id.String()
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
	for _, name := range []string{"manifest.json", "release.json"} {
		if p.entries[name] == nil {
			if name == "manifest.json" {
				return p, fmt.Errorf("缺少 manifest.json")
			}
			continue
		}
		p.Files[name], err = p.ReadFile(name)
		if err != nil {
			return Package{}, err
		}
	}
	if data := p.Files["release.json"]; data != nil {
		if err = decodeJSON(data, &p.Release); err != nil {
			return p, fmt.Errorf("release.json: %w", err)
		}
	}
	if err = decodeJSON(p.Files["manifest.json"], &p.Manifest); err != nil {
		return p, fmt.Errorf("manifest.json: %w", err)
	}
	m := &p.Manifest
	publisher := []rune(first(p.Release.Publisher.Name, "resource-package"))
	p.Release.Publisher.Name = string(publisher[:min(len(publisher), 128)])
	p.Release.ReleaseID = manifestID(p.Files["manifest.json"])
	if m.Version > 0 {
		p.Release.Version = m.Version
	}
	p.Release.Version = max(p.Release.Version, 1)
	m.ReleaseID, m.Version = p.Release.ReleaseID, p.Release.Version
	m.ManifestSHA256 = digest(p.Files["manifest.json"])
	p.Release.ManifestSHA256 = m.ManifestSHA256
	sections := []struct {
		kind, directory, extension string
		items                      *[]Entry
	}{{"skill", "skills", ".zip", &m.AgentResources.Skills}, {"rule", "rules", ".json", &m.AgentResources.Rules},
		{"connector", "connectors", ".json", &m.AgentResources.Connectors}, {"expert", "experts", ".zip", &m.AgentResources.Experts}}
	used := map[string]string{}
	for _, section := range sections {
		for i := range *section.items {
			entry := &(*section.items)[i]
			entry.Type = section.kind
			entry.Slug = first(entry.Slug, strings.TrimSuffix(path.Base(entry.Path), path.Ext(entry.Path)), entry.Name, section.kind)
			if entry.Slug == "." {
				entry.Slug = first(entry.Name, section.kind)
			}
			entry.SourceSlug = entry.Slug
			if entry.Path == "" {
				entry.Path = "agent/" + section.directory + "/" + entry.Slug + section.extension
			}
			entry.Slug = uniqueSlug(entry.Slug, section.kind, used)
			entry.Name = first(entry.Name, entry.Slug)
		}
	}
	return p, nil
}
