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
	MaxPackage  = 100 << 20
	MaxExpanded = 200 << 20
	MaxFiles    = 5000
	MaxFile     = 50 << 20
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

func checkSums(files map[string][]byte) error {
	lines := strings.Split(strings.TrimSuffix(string(files["CHECKSUMS.sha256"]), "\n"), "\n")
	if len(lines) != len(files)-2 {
		return fmt.Errorf("CHECKSUMS.sha256 条目数量不符")
	}
	paths := make([]string, 0, len(files)-2)
	for name := range files {
		if name != "release.json" && name != "CHECKSUMS.sha256" {
			paths = append(paths, name)
		}
	}
	slices.Sort(paths)
	for i, name := range paths {
		if lines[i] != strings.TrimPrefix(digest(files[name]), "sha256:")+"  "+name {
			return fmt.Errorf("CHECKSUMS.sha256 校验失败: %s", name)
		}
	}
	return nil
}

func Parse(data []byte) (Package, error) {
	p := Package{}
	files, err := readZIP(data, MaxPackage, MaxExpanded, MaxFiles, MaxFile)
	if err != nil {
		return p, err
	}
	for _, name := range []string{"release.json", "manifest.json", "CHECKSUMS.sha256"} {
		if len(files[name]) == 0 {
			return p, fmt.Errorf("缺少 %s", name)
		}
	}
	if err = checkSums(files); err != nil {
		return p, err
	}
	if err = json.Unmarshal(files["release.json"], &p.Release); err != nil {
		return p, fmt.Errorf("release.json 无效: %w", err)
	}
	if err = json.Unmarshal(files["manifest.json"], &p.Manifest); err != nil {
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
		if p.Release.Counts != nil && p.Release.Counts[section.kind] != len(section.items) {
			return Package{}, fmt.Errorf("%s 数量与 release.json 不一致", section.kind)
		}
		for _, entry := range section.items {
			if entry.Type != section.kind || !slugPattern.MatchString(entry.Slug) || seenSlugs[entry.Slug] ||
				strings.TrimSpace(entry.Name) == "" || len(entry.Name) > 200 ||
				!safePath(entry.Path) || !strings.HasPrefix(entry.Path, "agent/"+section.directory+"/") ||
				!shaPattern.MatchString(entry.SHA256) || referenced[entry.Path] || len(files[entry.Path]) == 0 ||
				digest(files[entry.Path]) != entry.SHA256 {
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
		for name, content := range files {
			if strings.HasPrefix(name, prefix) {
				if referenced[name] || len(content) != int(asset.Size) {
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
	for name := range files {
		if name != "release.json" && name != "CHECKSUMS.sha256" && !referenced[name] {
			return Package{}, fmt.Errorf("发布包包含未声明的文件: %s", name)
		}
	}
	p.Files = files
	return p, nil
}
