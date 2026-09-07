package skill

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"gopkg.in/yaml.v3"
	"io"
	"path"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

const MaxPackage = 20 << 20
const MaxExpanded = 50 << 20

var namePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

type Package struct {
	Name, Description, Content, SHA string
	Files                           map[string][]byte
	Front                           map[string]any
	Bytes                           []byte
}

func Parse(b []byte) (Package, error) {
	p := Package{Files: map[string][]byte{}, Bytes: b}
	if len(b) > MaxPackage {
		return p, fmt.Errorf("技能包超过 20 MiB")
	}
	r, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return p, fmt.Errorf("无效 ZIP")
	}
	if len(r.File) > 500 {
		return p, fmt.Errorf("技能包超过 500 个文件")
	}
	root := ""
	found := false
	seen := map[string]bool{}
	total := 0
	for _, f := range r.File {
		name := strings.TrimSuffix(f.Name, "/")
		if name == "" || strings.ContainsAny(name, "\\\x00:") || path.IsAbs(name) || path.Clean(name) != name || name == ".." || strings.HasPrefix(name, "../") || (!f.Mode().IsRegular() && !f.FileInfo().IsDir()) {
			return p, fmt.Errorf("技能包存在不安全路径或链接")
		}
		if seen[name] {
			return p, fmt.Errorf("技能包存在重复路径")
		}
		seen[name] = true
		if f.FileInfo().IsDir() {
			continue
		}
		if f.UncompressedSize64 > MaxExpanded {
			return p, fmt.Errorf("解包大小超限")
		}
		rd, err := f.Open()
		if err != nil {
			return p, err
		}
		data, err := io.ReadAll(io.LimitReader(rd, int64(MaxExpanded-total+1)))
		rd.Close()
		total += len(data)
		if err != nil || total > MaxExpanded {
			return p, fmt.Errorf("技能包损坏或解包大小超限")
		}
		p.Files[name] = data
		if path.Base(name) == "SKILL.md" {
			if found {
				return p, fmt.Errorf("每个技能包只能包含一个 SKILL.md")
			}
			found = true
			root = strings.TrimSuffix(name, "SKILL.md")
		}
	}
	if !found {
		return p, fmt.Errorf("缺少 SKILL.md")
	}
	normalized := map[string][]byte{}
	for name, data := range p.Files {
		if !strings.HasPrefix(name, root) {
			return p, fmt.Errorf("技能包包含根目录外文件")
		}
		normalized[strings.TrimPrefix(name, root)] = data
	}
	p.Files = normalized
	manifest := p.Files["SKILL.md"]
	if len(manifest) > 512<<10 || !utf8.Valid(manifest) {
		return p, fmt.Errorf("SKILL.md 必须是 512 KiB 内的 UTF-8 文本")
	}
	text := strings.ReplaceAll(string(manifest), "\r\n", "\n")
	if !strings.HasPrefix(text, "---\n") {
		return p, fmt.Errorf("SKILL.md 缺少 YAML 元信息")
	}
	end := strings.Index(text[4:], "\n---\n")
	if end < 0 {
		return p, fmt.Errorf("SKILL.md 元信息未闭合")
	}
	if err = yaml.Unmarshal([]byte(text[4:4+end]), &p.Front); err != nil {
		return p, fmt.Errorf("SKILL.md 元信息无效")
	}
	p.Name, _ = p.Front["name"].(string)
	p.Description, _ = p.Front["description"].(string)
	p.Content = text[4+end+5:]
	if !namePattern.MatchString(p.Name) || strings.TrimSpace(p.Description) == "" {
		return p, fmt.Errorf("技能名称必须为安全目录名，description 不能为空")
	}
	sum := sha256.Sum256(b)
	p.SHA = hex.EncodeToString(sum[:])
	return p, nil
}
func (p Package) Rewrite(name, description, content string) (Package, error) {
	if !namePattern.MatchString(name) || strings.TrimSpace(description) == "" {
		return Package{}, fmt.Errorf("技能名称或描述无效")
	}
	p.Front["name"] = name
	p.Front["description"] = description
	front, err := yaml.Marshal(p.Front)
	if err != nil {
		return Package{}, err
	}
	p.Files["SKILL.md"] = []byte("---\n" + string(front) + "---\n" + content)
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	names := []string{}
	for n := range p.Files {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		h := &zip.FileHeader{Name: n, Method: zip.Deflate}
		h.SetMode(0644)
		w, err := z.CreateHeader(h)
		if err != nil {
			return Package{}, err
		}
		if _, err = w.Write(p.Files[n]); err != nil {
			return Package{}, err
		}
	}
	if err = z.Close(); err != nil {
		return Package{}, err
	}
	return Parse(b.Bytes())
}
