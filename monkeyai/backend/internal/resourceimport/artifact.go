package resourceimport

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/skill"
)

var languagePattern = regexp.MustCompile(`^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$`)

type Skill struct {
	Entry          Entry
	Package        skill.Package
	SourceSHA      string
	Normalized     bool
	Normalizations []string
	Files          map[string][]byte
}

type Rule struct {
	Entry   Entry
	Content string
}

type ConnectorConfig struct {
	Transport    string            `json:"transport"`
	URL          string            `json:"url"`
	TimeoutMs    int               `json:"timeout_ms"`
	Auth         json.RawMessage   `json:"auth"`
	HeaderSchema json.RawMessage   `json:"header_schema"`
	OAuth        json.RawMessage   `json:"oauth"`
	NameI18n     map[string]string `json:"name_i18n"`
}

type Auth struct {
	Mode   string `json:"mode"`
	Header string `json:"header"`
}

type OAuth struct {
	Scope        string `json:"scope"`
	ClientID     string `json:"client_id"`
	TokenURL     string `json:"token_url"`
	AuthorizeURL string `json:"authorize_url"`
	ConfigSource string `json:"config_source"`
}

type Connector struct {
	Entry  Entry
	Config ConnectorConfig
	Auth   Auth
	OAuth  OAuth
}

type Expert struct {
	Entry      Entry
	Prompt     string
	Avatar     []byte
	Skills     []string
	Rules      []string
	Connectors []string
}

type Resources struct {
	Skills     map[string]Skill
	Rules      map[string]Rule
	Connectors map[string]Connector
	Experts    map[string]Expert
	types      map[string]string
}

func decodeStrict(data []byte, out any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("JSON 包含多个对象")
	}
	return nil
}

func translations(entries map[string]string) error {
	if len(entries) > 32 {
		return fmt.Errorf("翻译语言过多")
	}
	seen := map[string]bool{}
	for language, value := range entries {
		key := strings.ToLower(language)
		if !languagePattern.MatchString(language) || seen[key] || !utf8.ValidString(value) || strings.TrimSpace(value) == "" || len(value) > 8192 {
			return fmt.Errorf("翻译语言或内容无效: %s", language)
		}
		seen[key] = true
	}
	return nil
}

func agreeTranslations(manifest, artifact map[string]string) (map[string]string, error) {
	if err := translations(manifest); err != nil {
		return nil, err
	}
	if err := translations(artifact); err != nil {
		return nil, err
	}
	for language, value := range manifest {
		if other, ok := artifact[language]; ok && other != value {
			return nil, fmt.Errorf("manifest 与产物翻译不一致: %s", language)
		}
	}
	if len(manifest) > 0 {
		return manifest, nil
	}
	return artifact, nil
}

func zipSkillFiles(data []byte) (map[string][]byte, error) {
	files, err := readZIP(data, skill.MaxPackage, skill.MaxExpanded, 500, skill.MaxExpanded)
	if err != nil {
		return nil, err
	}
	root, found := "", false
	for name := range files {
		if name == "SKILL.md" || strings.HasSuffix(name, "/SKILL.md") {
			if found {
				return nil, fmt.Errorf("技能包存在多个 SKILL.md")
			}
			found, root = true, strings.TrimSuffix(name, "SKILL.md")
		}
	}
	if !found {
		return nil, fmt.Errorf("技能包缺少 SKILL.md")
	}
	if root == "" {
		return files, nil
	}
	out := make(map[string][]byte, len(files))
	for name, content := range files {
		if root == "" || strings.HasPrefix(name, root) {
			out[strings.TrimPrefix(name, root)] = content
			continue
		}
		if name == "skill.json" {
			out[name] = content
			continue
		}
		return nil, fmt.Errorf("技能包根目录外存在文件: %s", name)
	}
	return out, nil
}

func makeZIP(files map[string][]byte) ([]byte, error) {
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetMode(0644)
		entry, err := writer.CreateHeader(header)
		if err != nil {
			return nil, err
		}
		if _, err = entry.Write(files[name]); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func fileHash(files map[string][]byte) string {
	h := sha256.New()
	names := make([]string, 0, len(files))
	for name := range files {
		if name != "skill.json" {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	for _, name := range names {
		var size [8]byte
		binary.BigEndian.PutUint64(size[:], uint64(len(name)))
		h.Write(size[:])
		h.Write([]byte(name))
		binary.BigEndian.PutUint64(size[:], uint64(len(files[name])))
		h.Write(size[:])
		h.Write(files[name])
	}
	return "sha256:" + hex.EncodeToString(h.Sum(nil))
}

func normalizeDescription(data []byte) ([]byte, string, bool) {
	if !utf8.Valid(data) {
		return nil, "", false
	}
	lines := strings.SplitAfter(string(data), "\n")
	if len(lines) < 3 || strings.TrimSpace(lines[0]) != "---" {
		return nil, "", false
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			end = i
			break
		}
	}
	if end < 0 {
		return nil, "", false
	}
	lineIndex := -1
	for i := 1; i < end; i++ {
		if strings.HasPrefix(lines[i], "description:") {
			if lineIndex >= 0 {
				return nil, "", false
			}
			lineIndex = i
		}
	}
	if lineIndex < 0 {
		return nil, "", false
	}
	original := lines[lineIndex]
	value := strings.TrimSpace(strings.TrimPrefix(original, "description:"))
	if !strings.Contains(value, ": ") || value == "" || strings.ContainsAny(value[:1], `"'|>`) {
		return nil, "", false
	}
	quoted, _ := json.Marshal(value)
	ending := "\n"
	if strings.HasSuffix(original, "\r\n") {
		ending = "\r\n"
	} else if !strings.HasSuffix(original, "\n") {
		ending = ""
	}
	lines[lineIndex] = "description: " + string(quoted) + ending
	return []byte(strings.Join(lines, "")), fmt.Sprintf("SKILL.md 第 %d 行 description：%s → %s", lineIndex+1, strings.TrimSpace(original), strings.TrimSpace(lines[lineIndex])), true
}

func parseSkill(entry Entry, data []byte, sourceSHA string, files map[string][]byte) (Skill, error) {
	result := Skill{Entry: entry, SourceSHA: sourceSHA, Files: files}
	if !slugPattern.MatchString(entry.Slug) || len(entry.Slug) > 64 {
		return result, fmt.Errorf("技能 slug 不符合安全目录名规则")
	}
	var metadata struct {
		Slug            string            `json:"slug"`
		Name            string            `json:"name"`
		DescriptionI18n map[string]string `json:"description_i18n"`
	}
	if raw := files["skill.json"]; len(raw) == 0 || json.Unmarshal(raw, &metadata) != nil || metadata.Slug != entry.Slug || metadata.Name != entry.Name {
		return result, fmt.Errorf("skill.json 与 manifest 不一致")
	}
	var err error
	result.Entry.DescriptionI18n, err = agreeTranslations(entry.DescriptionI18n, metadata.DescriptionI18n)
	if err != nil {
		return result, err
	}
	if err = translations(entry.NameI18n); err != nil {
		return result, err
	}
	if len(data) != 0 {
		result.Package, err = skill.Parse(data)
	} else {
		result.Package, err = skill.Package{}, fmt.Errorf("技能包为空")
	}
	if err != nil && result.Package.Front == nil {
		if fixed, notice, ok := normalizeDescription(files["SKILL.md"]); ok {
			updated := maps.Clone(files)
			updated["SKILL.md"] = fixed
			if archive, packErr := makeZIP(updated); packErr == nil {
				if parsed, parseErr := skill.Parse(archive); parseErr == nil || parsed.Front != nil {
					result.Package, err = parsed, parseErr
					result.Normalized = true
					result.Normalizations = append(result.Normalizations, notice)
				}
			}
		}
	}
	if err != nil && result.Package.Front != nil && result.Package.Description != "" {
		oldName := result.Package.Name
		result.Package, err = result.Package.Rewrite(entry.Slug, result.Package.Description, result.Package.Content)
		if err == nil {
			result.Normalized = true
			result.Normalizations = append(result.Normalizations, fmt.Sprintf("SKILL.md name：%s → %s", oldName, entry.Slug))
		}
	}
	if err != nil {
		return result, fmt.Errorf("技能包无效: %w", err)
	}
	return result, nil
}

func embeddedSkill(entry Entry, files map[string][]byte) (Skill, error) {
	metadata := map[string]any{"slug": entry.Slug, "name": entry.Name}
	b, err := json.Marshal(metadata)
	if err != nil {
		return Skill{}, err
	}
	copyFiles := make(map[string][]byte, len(files)+1)
	for name, content := range files {
		copyFiles[name] = content
	}
	copyFiles["skill.json"] = b
	archive, err := makeZIP(copyFiles)
	if err != nil {
		return Skill{}, err
	}
	return parseSkill(entry, archive, fileHash(files), copyFiles)
}

func parseExpert(entry Entry, data []byte, resources *Resources) (Expert, error) {
	out := Expert{Entry: entry}
	files, err := readZIP(data, MaxPackage, MaxExpanded, MaxFiles, MaxFile)
	if err != nil {
		return out, fmt.Errorf("专家 ZIP 无效: %w", err)
	}
	var info struct {
		Slug      string              `json:"slug"`
		Name      string              `json:"name"`
		Prompt    string              `json:"prompt_path"`
		Avatar    string              `json:"avatar"`
		DependsOn map[string][]string `json:"depends_on"`
	}
	if json.Unmarshal(files["expert.json"], &info) != nil || info.Slug != entry.Slug || info.Name != entry.Name || info.Prompt != "agents/expert.md" {
		return out, fmt.Errorf("expert.json 与 manifest 不一致: %s", entry.Slug)
	}
	prompt := files[info.Prompt]
	if len(prompt) == 0 || len(prompt) > 2<<20 || !utf8.Valid(prompt) {
		return out, fmt.Errorf("专家指令为空或格式无效: %s", entry.Slug)
	}
	out.Prompt = string(prompt)
	if info.Avatar != "" {
		out.Avatar = files[info.Avatar]
		if info.Avatar != "avatar.webp" || len(out.Avatar) == 0 || http.DetectContentType(out.Avatar) != "image/webp" {
			return out, fmt.Errorf("专家头像无效: %s", entry.Slug)
		}
	}
	out.Skills, out.Rules, out.Connectors = info.DependsOn["skills"], info.DependsOn["rules"], info.DependsOn["connectors"]
	for _, slug := range out.Connectors {
		if _, ok := resources.Connectors[slug]; !ok {
			return out, fmt.Errorf("专家依赖的连接器不存在: %s", slug)
		}
	}
	for _, slug := range out.Skills {
		prefix := "skills/" + slug + "/"
		flat := map[string][]byte{}
		for name, data := range files {
			if strings.HasPrefix(name, prefix) {
				flat[strings.TrimPrefix(name, prefix)] = data
			}
		}
		if len(flat) == 0 {
			return out, fmt.Errorf("专家依赖的技能缺失: %s", slug)
		}
		if existing, ok := resources.Skills[slug]; ok {
			if fileHash(existing.Files) != fileHash(flat) {
				return out, fmt.Errorf("专家技能与同 slug 资源内容不一致: %s", slug)
			}
			continue
		}
		if !slugPattern.MatchString(slug) || (resources.types[slug] != "" && resources.types[slug] != "skill") {
			return out, fmt.Errorf("专家技能 slug 与其他资源冲突: %s", slug)
		}
		private := Entry{Type: "skill", Slug: slug, Name: slug}
		item, err := embeddedSkill(private, flat)
		if err != nil {
			return out, fmt.Errorf("专家技能无效 %s: %w", slug, err)
		}
		resources.Skills[slug] = item
		resources.types[slug] = "skill"
	}
	for _, slug := range out.Rules {
		content, ok := files["rules/"+slug+".md"]
		if existing, found := resources.Rules[slug]; found {
			if ok && existing.Content != string(content) {
				return out, fmt.Errorf("专家规则与同 slug 资源内容不一致: %s", slug)
			}
			continue
		}
		if !ok || !utf8.Valid(content) || len(bytes.TrimSpace(content)) == 0 || !slugPattern.MatchString(slug) {
			return out, fmt.Errorf("专家依赖的规则缺失或无效: %s", slug)
		}
		if resources.types[slug] != "" && resources.types[slug] != "rule" {
			return out, fmt.Errorf("专家规则 slug 与其他资源冲突: %s", slug)
		}
		resources.Rules[slug] = Rule{Entry: Entry{Type: "rule", Slug: slug, Name: slug}, Content: string(content)}
		resources.types[slug] = "rule"
	}
	for name := range files {
		if name == "expert.json" || name == info.Prompt || name == info.Avatar {
			continue
		}
		known := false
		for _, slug := range out.Skills {
			known = known || strings.HasPrefix(name, "skills/"+slug+"/")
		}
		for _, slug := range out.Rules {
			known = known || name == "rules/"+slug+".md"
		}
		if !known {
			return out, fmt.Errorf("专家包含未声明的依赖文件: %s", name)
		}
	}
	return out, nil
}

func ParseResources(p Package) (Resources, error) {
	out := Resources{Skills: map[string]Skill{}, Rules: map[string]Rule{}, Connectors: map[string]Connector{}, Experts: map[string]Expert{}, types: map[string]string{}}
	for _, entry := range append(append(append(append([]Entry{}, p.Manifest.AgentResources.Skills...), p.Manifest.AgentResources.Rules...), p.Manifest.AgentResources.Connectors...), p.Manifest.AgentResources.Experts...) {
		out.types[entry.Slug] = entry.Type
	}
	for _, entry := range p.Manifest.AgentResources.Skills {
		files, err := zipSkillFiles(p.Files[entry.Path])
		if err != nil {
			return out, fmt.Errorf("技能 %s: %w", entry.Slug, err)
		}
		archive := p.Files[entry.Path]
		original, err := readZIP(archive, skill.MaxPackage, skill.MaxExpanded, 500, skill.MaxExpanded)
		if err != nil {
			return out, err
		}
		if _, rootSkill := original["SKILL.md"]; !rootSkill {
			archive, err = makeZIP(files)
			if err != nil {
				return out, err
			}
		}
		item, err := parseSkill(entry, archive, entry.SHA256, files)
		if err != nil {
			return out, fmt.Errorf("技能 %s: %w", entry.Slug, err)
		}
		out.Skills[entry.Slug] = item
	}
	for _, entry := range p.Manifest.AgentResources.Rules {
		var info struct {
			Slug, Name, Content string
		}
		if err := json.Unmarshal(p.Files[entry.Path], &info); err != nil || info.Slug != entry.Slug || info.Name != entry.Name || strings.TrimSpace(info.Content) == "" {
			return out, fmt.Errorf("规则产物无效: %s", entry.Slug)
		}
		if err := translations(entry.NameI18n); err != nil {
			return out, err
		}
		if err := translations(entry.DescriptionI18n); err != nil {
			return out, err
		}
		out.Rules[entry.Slug] = Rule{Entry: entry, Content: info.Content}
	}
	for _, entry := range p.Manifest.AgentResources.Connectors {
		var info struct {
			Slug, Name string
			Config     ConnectorConfig
		}
		if err := json.Unmarshal(p.Files[entry.Path], &info); err != nil || info.Slug != entry.Slug || info.Name != entry.Name || info.Config.Transport != "http" || info.Config.URL == "" || info.Config.TimeoutMs < 1000 || info.Config.TimeoutMs > 120000 {
			return out, fmt.Errorf("连接器产物无效: %s", entry.Slug)
		}
		var headers []json.RawMessage
		if len(info.Config.HeaderSchema) > 0 && (json.Unmarshal(info.Config.HeaderSchema, &headers) != nil || len(headers) != 0) {
			return out, fmt.Errorf("连接器 Header Schema 暂不支持: %s", entry.Slug)
		}
		var err error
		entry.NameI18n, err = agreeTranslations(entry.NameI18n, info.Config.NameI18n)
		if err != nil {
			return out, err
		}
		if err = translations(entry.DescriptionI18n); err != nil {
			return out, err
		}
		parsedURL, err := url.Parse(info.Config.URL)
		if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Host == "" || parsedURL.User != nil {
			return out, fmt.Errorf("连接器 URL 无效: %s", entry.Slug)
		}
		var auth Auth
		if err = decodeStrict(info.Config.Auth, &auth); err != nil {
			return out, fmt.Errorf("连接器认证无效 %s: %w", entry.Slug, err)
		}
		var oauth OAuth
		if len(info.Config.OAuth) > 0 {
			if err = decodeStrict(info.Config.OAuth, &oauth); err != nil {
				return out, fmt.Errorf("连接器 OAuth 配置无效 %s: %w", entry.Slug, err)
			}
		}
		switch auth.Mode {
		case "none":
			if auth.Header != "" {
				return out, fmt.Errorf("免认证连接器不能指定 Header: %s", entry.Slug)
			}
		case "header":
			if auth.Header == "" || strings.ContainsAny(auth.Header, "\r\n:") {
				return out, fmt.Errorf("连接器 Header 名称无效: %s", entry.Slug)
			}
		case "oauth":
			if auth.Header != "" || oauth.ConfigSource != "dcr" || oauth.ClientID != "" || oauth.AuthorizeURL != "" || oauth.TokenURL != "" {
				return out, fmt.Errorf("本期仅支持动态注册 OAuth: %s", entry.Slug)
			}
		default:
			return out, fmt.Errorf("连接器认证模式不支持: %s", entry.Slug)
		}
		out.Connectors[entry.Slug] = Connector{Entry: entry, Config: info.Config, Auth: auth, OAuth: oauth}
	}
	for _, entry := range p.Manifest.AgentResources.Experts {
		if err := translations(entry.NameI18n); err != nil {
			return out, err
		}
		if err := translations(entry.DescriptionI18n); err != nil {
			return out, err
		}
		item, err := parseExpert(entry, p.Files[entry.Path], &out)
		if err != nil {
			return out, err
		}
		out.Experts[entry.Slug] = item
	}
	return out, nil
}
