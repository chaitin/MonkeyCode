package kb

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
	"unicode/utf8"
)

var importKey = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

type ImportFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type ImportEntry struct {
	Slug         string       `json:"slug"`
	MetadataPath string       `json:"metadata_path"`
	TreePath     string       `json:"tree_path"`
	Files        []ImportFile `json:"files"`
}
type ImportManifest struct {
	SchemaVersion  int           `json:"schema_version"`
	PublisherID    string        `json:"publisher_id"`
	ReleaseID      string        `json:"release_id"`
	KnowledgeBases []ImportEntry `json:"knowledge_bases"`
}
type ImportMetadata struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
}
type ImportNode struct {
	Key         string  `json:"key"`
	NodeType    string  `json:"node_type"`
	ParentKey   *string `json:"parent_key"`
	Order       int     `json:"order"`
	Title       string  `json:"title"`
	ContentPath string  `json:"content_path,omitempty"`
	SourceType  string  `json:"source_type,omitempty"`
	FileName    string  `json:"file_name,omitempty"`
	MIMEType    string  `json:"mime_type,omitempty"`
}
type ImportBook struct {
	Slug     string
	Metadata ImportMetadata
	Nodes    []ImportNode
	Assets   map[string]ImportAsset
}

// ImportAsset retains only metadata; image bytes stay in the ZIP until upload.
type ImportAsset struct {
	Name   string
	MIME   string
	path   string
	sha256 string
}

func (b ImportBook) RewriteAssets(content, id string) string {
	return rewriteImportAssetReferences(content, func(name string) string {
		return assetURL(id, name)
	})
}

type ImportPackage struct {
	Manifest ImportManifest
	Books    []ImportBook
	SHA256   string
	files    map[string]*zip.File
}

func importHash(data []byte) string {
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:])
}
func importPath(name string) bool {
	return name != "" && path.Clean(name) == name && name != "." && name != ".." && !strings.HasPrefix(name, "../") && !strings.HasPrefix(name, "/") && !strings.ContainsAny(name, "\\\x00:\r\n")
}
func strictImportJSON(data []byte, out any) error {
	// Reject duplicate object keys, including nested objects.
	d := json.NewDecoder(bytes.NewReader(data))
	var value func() error
	value = func() error {
		token, err := d.Token()
		if err != nil {
			return err
		}
		delim, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				raw, e := d.Token()
				if e != nil {
					return e
				}
				key, ok := raw.(string)
				if !ok || seen[key] {
					return fmt.Errorf("JSON 字段重复")
				}
				seen[key] = true
				if e = value(); e != nil {
					return e
				}
			}
		case '[':
			for d.More() {
				if e := value(); e != nil {
					return e
				}
			}
		default:
			return fmt.Errorf("JSON 结构无效")
		}
		_, err = d.Token()
		return err
	}
	if err := value(); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return fmt.Errorf("JSON 尾部无效")
	}
	d = json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	return d.Decode(out)
}
func (p *ImportPackage) read(name string, limit int64) ([]byte, error) {
	f := p.files[name]
	if f == nil || f.UncompressedSize64 > uint64(limit) {
		return nil, fmt.Errorf("文件缺失或超限: %s", name)
	}
	r, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer r.Close()
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit || uint64(len(data)) != f.UncompressedSize64 {
		return nil, fmt.Errorf("文件大小无效: %s", name)
	}
	return data, nil
}
func (p *ImportPackage) verifyFile(file ImportFile) error {
	f := p.files[file.Path]
	if f == nil || f.UncompressedSize64 != uint64(file.Size) {
		return fmt.Errorf("文件大小无效: %s", file.Path)
	}
	r, err := f.Open()
	if err != nil {
		return err
	}
	defer r.Close()
	hash := sha256.New()
	size, err := io.Copy(hash, io.LimitReader(r, file.Size+1))
	if err != nil {
		return err
	}
	if size != file.Size || "sha256:"+hex.EncodeToString(hash.Sum(nil)) != file.SHA256 {
		return fmt.Errorf("文件摘要不匹配: %s", file.Path)
	}
	return nil
}

func (p *ImportPackage) imageHeader(name string) ([]byte, error) {
	r, err := p.files[name].Open()
	if err != nil {
		return nil, err
	}
	defer r.Close()
	return io.ReadAll(io.LimitReader(r, 512))
}

func (p *ImportPackage) assetData(asset ImportAsset) ([]byte, error) {
	data, err := p.read(asset.path, 32<<20)
	if err != nil {
		return nil, err
	}
	if importHash(data) != asset.sha256 || assetMIME(data) != asset.MIME {
		return nil, fmt.Errorf("图片内容已变化: %s", asset.Name)
	}
	return data, nil
}

func (p *ImportPackage) Content(node ImportNode) (string, error) {
	data, err := p.read(node.ContentPath, 8<<20)
	if err != nil {
		return "", err
	}
	if !utf8.Valid(data) || strings.TrimSpace(string(data)) == "" || bytes.ContainsRune(data, 0) {
		return "", fmt.Errorf("正文为空或 UTF-8 无效: %s", node.Key)
	}
	return string(data), nil
}

func ParseImportPackage(reader io.ReaderAt, size int64) (*ImportPackage, error) {
	if size <= 0 || size > 2<<30 {
		return nil, fmt.Errorf("资源包大小超限")
	}
	z, err := zip.NewReader(reader, size)
	if err != nil {
		return nil, err
	}
	p := &ImportPackage{files: map[string]*zip.File{}}
	seen := map[string]bool{}
	var total uint64
	for _, f := range z.File {
		name := strings.TrimSuffix(f.Name, "/")
		if !importPath(name) || f.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("不安全 ZIP 路径")
		}
		lower := strings.ToLower(name)
		if seen[lower] {
			return nil, fmt.Errorf("ZIP 路径重复")
		}
		seen[lower] = true
		if f.FileInfo().IsDir() {
			continue
		}
		if !f.Mode().IsRegular() || f.UncompressedSize64 > 4<<30-total {
			return nil, fmt.Errorf("ZIP 展开大小或文件类型无效")
		}
		total += f.UncompressedSize64
		p.files[name] = f
	}
	for name := range p.files {
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			if p.files[parent] != nil {
				return nil, fmt.Errorf("文件与目录路径冲突")
			}
		}
	}
	raw, err := p.read("manifest.json", 32<<20)
	if err != nil {
		return nil, err
	}
	var manifest map[string]json.RawMessage
	if err = strictImportJSON(raw, &manifest); err != nil {
		return nil, err
	}
	if err = strictImportJSON(manifest["knowledge_resources"], &p.Manifest); err != nil {
		return nil, err
	}
	m := p.Manifest
	if m.SchemaVersion != 1 || !importKey.MatchString(m.PublisherID) || !importKey.MatchString(m.ReleaseID) || len(m.KnowledgeBases) == 0 || len(m.KnowledgeBases) > 100 {
		return nil, fmt.Errorf("知识库分区版本、发布身份或数量无效")
	}
	section, _ := json.Marshal(m)
	p.SHA256 = importHash(section)
	slugs := map[string]bool{}
	claimed := map[string]bool{}
	nodeCount := 0
	for _, entry := range m.KnowledgeBases {
		if !importKey.MatchString(entry.Slug) || slugs[entry.Slug] {
			return nil, fmt.Errorf("知识库 slug 无效或重复")
		}
		slugs[entry.Slug] = true
		prefix := "knowledge/" + entry.Slug + "/"
		listed := map[string]bool{}
		checksums := map[string]string{}
		for _, f := range entry.Files {
			if !importPath(f.Path) || !strings.HasPrefix(f.Path, prefix) || claimed[f.Path] || f.Size < 0 || f.Size > 32<<20 {
				return nil, fmt.Errorf("文件清单无效: %s", f.Path)
			}
			claimed[f.Path] = true
			listed[f.Path] = true
			checksums[f.Path] = f.SHA256
			if e := p.verifyFile(f); e != nil {
				return nil, e
			}
		}
		if !listed[entry.MetadataPath] || !listed[entry.TreePath] {
			return nil, fmt.Errorf("元数据文件未声明")
		}
		book := ImportBook{Slug: entry.Slug, Assets: map[string]ImportAsset{}}
		for name := range listed {
			if !strings.HasPrefix(name, prefix+"assets/") {
				continue
			}
			base := strings.TrimPrefix(name, prefix+"assets/")
			header, e := p.imageHeader(name)
			if e != nil {
				return nil, e
			}
			mime := assetMIME(header)
			extension := map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}[mime]
			if !assetName.MatchString(base) || mime == "" || base != strings.TrimPrefix(checksums[name], "sha256:")+"."+extension {
				return nil, fmt.Errorf("图片类型或内容地址无效: %s", name)
			}
			book.Assets[base] = ImportAsset{Name: base, MIME: mime, path: name, sha256: checksums[name]}
		}
		data, _ := p.read(entry.MetadataPath, 32<<20)
		if err = strictImportJSON(data, &book.Metadata); err != nil {
			return nil, err
		}
		if strings.TrimSpace(book.Metadata.Name) == "" || len(book.Metadata.Name) > 200 || !utf8.ValidString(book.Metadata.Name) || strings.ContainsRune(book.Metadata.Name, 0) {
			return nil, fmt.Errorf("知识库名称无效")
		}
		for i, tag := range book.Metadata.Tags {
			tag = strings.TrimSpace(tag)
			if tag == "" || len(tag) > 100 || strings.ContainsRune(tag, 0) {
				return nil, fmt.Errorf("标签无效")
			}
			book.Metadata.Tags[i] = tag
		}
		var tree struct {
			Nodes []ImportNode `json:"nodes"`
		}
		data, _ = p.read(entry.TreePath, 32<<20)
		if err = strictImportJSON(data, &tree); err != nil {
			return nil, err
		}
		nodeCount += len(tree.Nodes)
		if nodeCount > 50000 {
			return nil, fmt.Errorf("节点数超过 50000")
		}
		byKey := map[string]ImportNode{}
		children := map[string][]ImportNode{}
		orders := map[string]bool{}
		for _, node := range tree.Nodes {
			if !importKey.MatchString(node.Key) || byKey[node.Key].Key != "" || node.Order < 0 || node.Order > 50000 || strings.TrimSpace(node.Title) == "" || !utf8.ValidString(node.Title) || strings.ContainsRune(node.Title, 0) {
				return nil, fmt.Errorf("节点 key、名称或顺序无效")
			}
			if node.NodeType != "folder" && node.NodeType != "document" {
				return nil, fmt.Errorf("节点类型无效")
			}
			parent := ""
			if node.ParentKey != nil {
				parent = *node.ParentKey
				if parent == "" {
					return nil, fmt.Errorf("根节点 parent_key 应为 null")
				}
			}
			order := fmt.Sprintf("%s:%d", parent, node.Order)
			if orders[order] {
				return nil, fmt.Errorf("同级顺序重复")
			}
			orders[order] = true
			if node.NodeType == "document" {
				if !listed[node.ContentPath] {
					return nil, fmt.Errorf("正文未列入文件清单")
				}
				if node.SourceType == "" {
					node.SourceType = "text"
				}
				if node.SourceType != "text" && node.SourceType != "file" {
					return nil, fmt.Errorf("文档来源类型无效")
				}
				content, e := p.Content(node)
				if e != nil {
					return nil, e
				}
				if _, e = book.importImageContent(content, ""); e != nil {
					return nil, e
				}

			} else if node.ContentPath != "" || node.SourceType != "" || node.FileName != "" || node.MIMEType != "" {
				return nil, fmt.Errorf("文件夹不得声明正文属性")
			}
			byKey[node.Key] = node
			children[parent] = append(children[parent], node)
		}
		for _, node := range byKey {
			if node.ParentKey != nil && byKey[*node.ParentKey].NodeType != "folder" {
				return nil, fmt.Errorf("父节点缺失或非文件夹")
			}
		}
		for parent := range children {
			slices.SortFunc(children[parent], func(a, b ImportNode) int { return a.Order - b.Order })
		}
		queue := children[""]
		for len(queue) > 0 {
			node := queue[0]
			queue = queue[1:]
			book.Nodes = append(book.Nodes, node)
			queue = append(queue, children[node.Key]...)
		}
		if len(book.Nodes) != len(tree.Nodes) {
			return nil, fmt.Errorf("目录存在环")
		}
		p.Books = append(p.Books, book)
	}
	return p, nil
}
