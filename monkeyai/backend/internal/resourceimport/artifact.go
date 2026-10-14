package resourceimport

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/skill"
)

type Skill struct {
	Entry          Entry
	Package        skill.Package
	SourceSHA      string
	StoredFileSHA  string
	StoredSize     int
	FileCount      int
	SourcePath     string
	ExpertPath     string
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
	AvatarPath string
	AvatarSHA  string
	HasAvatar  bool
	Skills     []string
	Rules      []string
	Connectors []string
	Warnings   []string
}

type Resources struct {
	Skills     map[string]Skill
	Rules      map[string]Rule
	Connectors map[string]Connector
	Experts    map[string]Expert
	types      map[string]string
	aliases    map[string]string
	streamed   bool
}

func (r Resources) resolve(kind, slug string) string {
	return first(r.aliases[kind+":"+slug], slug)
}

func mergeTranslations(manifest, artifact map[string]string) map[string]string {
	out := maps.Clone(artifact)
	if out == nil {
		out = map[string]string{}
	}
	maps.Copy(out, manifest)
	return out
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
	var metadata struct {
		Slug            string            `json:"slug"`
		Name            string            `json:"name"`
		DescriptionI18n map[string]string `json:"description_i18n"`
	}
	if raw := files["skill.json"]; raw != nil {
		if err := decodeJSON(raw, &metadata); err != nil {
			return result, fmt.Errorf("skill.json: %w", err)
		}
	}
	result.Entry.DescriptionI18n = mergeTranslations(entry.DescriptionI18n, metadata.DescriptionI18n)
	var err error
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
	if err != nil {
		oldName := result.Package.Name
		name := entry.Slug
		if !slugPattern.MatchString(name) || len(name) > 64 {
			name = "skill-" + strings.TrimPrefix(fileHash(files), "sha256:")[:16]
		}
		if result.Package.Front == nil {
			result.Package = skill.Package{Files: maps.Clone(files), Front: map[string]any{}, Content: string(files["SKILL.md"])}
		}
		desc := first(result.Package.Description, description(result.Entry.DescriptionI18n), entry.Name, name)
		result.Package, err = result.Package.Rewrite(name, desc, result.Package.Content)
		if err == nil {
			result.Normalized = true
			result.Normalizations = append(result.Normalizations, fmt.Sprintf("SKILL.md 元信息已补齐：%s → %s", oldName, name))
		}
	}
	if err != nil {
		return result, fmt.Errorf("技能包无效: %w", err)
	}
	result.StoredFileSHA = fileHash(result.Package.Files)
	result.StoredSize = len(result.Package.Bytes)
	result.FileCount = len(result.Package.Files)
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
	files, err := readZIP(data, MaxExpertPackage, MaxExpertExpanded, MaxFiles, 50<<20)
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
	if raw := files["expert.json"]; raw != nil {
		if err := decodeJSON(raw, &info); err != nil {
			return out, fmt.Errorf("expert.json: %w", err)
		}
	}
	out.Prompt = string(files[first(info.Prompt, "agents/expert.md")])
	out.AvatarPath = first(info.Avatar, "avatar.webp")
	out.Avatar = files[out.AvatarPath]
	for _, source := range info.DependsOn["connectors"] {
		slug := resources.resolve("connector", source)
		if _, ok := resources.Connectors[slug]; ok {
			out.Connectors = append(out.Connectors, slug)
		} else {
			out.Warnings = append(out.Warnings, "已忽略缺失的连接器依赖："+slug)
		}
	}
	for _, source := range info.DependsOn["skills"] {
		slug := resources.resolve("skill", source)
		if _, ok := resources.Skills[slug]; ok {
			out.Skills = append(out.Skills, slug)
			continue
		}
		prefix := "skills/" + source + "/"
		flat := map[string][]byte{}
		for name, data := range files {
			if strings.HasPrefix(name, prefix) {
				flat[strings.TrimPrefix(name, prefix)] = data
			}
		}
		if len(flat) == 0 {
			out.Warnings = append(out.Warnings, "已忽略缺失的技能依赖："+slug)
			continue
		}
		slug = uniqueSlug(source, "skill", resources.types)
		private := Entry{Type: "skill", Slug: slug, SourceSlug: source, Name: source}
		item, err := embeddedSkill(private, flat)
		if err != nil {
			return out, fmt.Errorf("专家技能 %s: %w", slug, err)
		}
		item.ExpertPath = entry.Path
		if resources.streamed {
			item.Files, item.Package.Files, item.Package.Bytes = nil, nil, nil
		}
		resources.Skills[slug] = item
		resources.aliases["skill:"+source] = slug
		out.Skills = append(out.Skills, slug)
	}
	for _, source := range info.DependsOn["rules"] {
		slug := resources.resolve("rule", source)
		if _, found := resources.Rules[slug]; found {
			out.Rules = append(out.Rules, slug)
			continue
		}
		content, ok := files["rules/"+source+".md"]
		if !ok {
			out.Warnings = append(out.Warnings, "已忽略缺失的规则依赖："+slug)
			continue
		}
		slug = uniqueSlug(source, "rule", resources.types)
		resources.Rules[slug] = Rule{Entry: Entry{Type: "rule", Slug: slug, Name: source}, Content: string(content)}
		resources.aliases["rule:"+source] = slug
		out.Rules = append(out.Rules, slug)
	}
	slices.Sort(out.Skills)
	out.Skills = slices.Compact(out.Skills)
	slices.Sort(out.Rules)
	out.Rules = slices.Compact(out.Rules)
	slices.Sort(out.Connectors)
	out.Connectors = slices.Compact(out.Connectors)
	out.HasAvatar = len(out.Avatar) != 0
	out.AvatarSHA = digest(out.Avatar)
	if resources.streamed {
		out.Avatar = nil
	}
	return out, nil
}

func parseEntrySkill(entry Entry, archive []byte) (Skill, error) {
	sourceSHA := digest(archive)
	files, err := zipSkillFiles(archive)
	if err != nil {
		return Skill{}, err
	}
	original, err := readZIP(archive, skill.MaxPackage, skill.MaxExpanded, 500, skill.MaxExpanded)
	if err != nil {
		return Skill{}, err
	}
	if _, rootSkill := original["SKILL.md"]; !rootSkill {
		archive, err = makeZIP(files)
		if err != nil {
			return Skill{}, err
		}
	}
	return parseSkill(entry, archive, sourceSHA, files)
}

func (p Package) SkillBytes(item Skill) ([]byte, error) {
	if !p.streamed {
		return item.Package.Bytes, nil
	}
	var parsed Skill
	if item.SourcePath != "" {
		archive, err := p.ReadFile(item.SourcePath)
		if err != nil {
			return nil, err
		}
		parsed, err = parseEntrySkill(item.Entry, archive)
		if err != nil {
			return nil, err
		}
	} else {
		archive, err := p.ReadFile(item.ExpertPath)
		if err != nil {
			return nil, err
		}
		files, err := readZIP(archive, MaxExpertPackage, MaxExpertExpanded, MaxFiles, 50<<20)
		if err != nil {
			return nil, err
		}
		flat := map[string][]byte{}
		prefix := "skills/" + first(item.Entry.SourceSlug, item.Entry.Slug) + "/"
		for name, content := range files {
			if strings.HasPrefix(name, prefix) {
				flat[strings.TrimPrefix(name, prefix)] = content
			}
		}
		parsed, err = embeddedSkill(item.Entry, flat)
		if err != nil {
			return nil, err
		}
	}
	return parsed.Package.Bytes, nil
}

func (p Package) AvatarBytes(item Expert) ([]byte, error) {
	if !p.streamed {
		return item.Avatar, nil
	}
	archive, err := p.ReadFile(item.Entry.Path)
	if err != nil {
		return nil, err
	}
	files, err := readZIP(archive, MaxExpertPackage, MaxExpertExpanded, MaxFiles, 50<<20)
	if err != nil {
		return nil, err
	}
	return files[item.AvatarPath], nil
}

func ParseResources(p Package) (Resources, error) {
	out := Resources{Skills: map[string]Skill{}, Rules: map[string]Rule{}, Connectors: map[string]Connector{}, Experts: map[string]Expert{}, types: map[string]string{}, aliases: map[string]string{}, streamed: p.streamed}
	retainedText := 0
	for _, entry := range append(append(append(append([]Entry{}, p.Manifest.AgentResources.Skills...), p.Manifest.AgentResources.Rules...), p.Manifest.AgentResources.Connectors...), p.Manifest.AgentResources.Experts...) {
		out.types[entry.Slug] = entry.Type
		key := entry.Type + ":" + first(entry.SourceSlug, entry.Slug)
		if out.aliases[key] == "" {
			out.aliases[key] = entry.Slug
		}
	}
	for _, entry := range p.Manifest.AgentResources.Skills {
		archive, err := p.ReadFile(entry.Path)
		if err != nil {
			return out, fmt.Errorf("技能 %s: %w", entry.Slug, err)
		}
		item, err := parseEntrySkill(entry, archive)
		if err != nil {
			return out, fmt.Errorf("技能 %s: %w", entry.Slug, err)
		}
		item.SourcePath = entry.Path
		retainedText += len(item.Package.Content)
		if retainedText > MaxRetainedText {
			return out, fmt.Errorf("资源文本总量超限")
		}
		if p.streamed {
			item.Files, item.Package.Files, item.Package.Bytes = nil, nil, nil
		}
		out.Skills[entry.Slug] = item
	}
	for _, entry := range p.Manifest.AgentResources.Rules {
		if file := p.entries[entry.Path]; file != nil && file.UncompressedSize64 > 2<<20 {
			return out, fmt.Errorf("规则产物过大: %s", entry.Slug)
		}
		var info struct {
			Content string
		}
		data, err := p.ReadFile(entry.Path)
		if err != nil {
			return out, err
		}
		if err := decodeJSON(data, &info); err != nil {
			return out, fmt.Errorf("规则 %s: %w", entry.Slug, err)
		}
		entry.SHA256 = digest(data)
		retainedText += len(info.Content)
		if retainedText > MaxRetainedText {
			return out, fmt.Errorf("资源文本总量超限")
		}
		out.Rules[entry.Slug] = Rule{Entry: entry, Content: info.Content}
	}
	for _, entry := range p.Manifest.AgentResources.Connectors {
		if file := p.entries[entry.Path]; file != nil && file.UncompressedSize64 > 1<<20 {
			return out, fmt.Errorf("连接器产物过大: %s", entry.Slug)
		}
		var info struct {
			Config ConnectorConfig
		}
		data, err := p.ReadFile(entry.Path)
		if err != nil {
			return out, err
		}
		if err := decodeJSON(data, &info); err != nil {
			return out, fmt.Errorf("连接器 %s: %w", entry.Slug, err)
		}
		entry.SHA256 = digest(data)
		entry.NameI18n = mergeTranslations(entry.NameI18n, info.Config.NameI18n)
		if info.Config.TimeoutMs == 0 {
			info.Config.TimeoutMs = 25000
		}
		info.Config.TimeoutMs = min(max(info.Config.TimeoutMs, 1000), 120000)
		var auth Auth
		if len(info.Config.Auth) > 0 {
			if err := decodeJSON(info.Config.Auth, &auth); err != nil {
				return out, err
			}
		}
		var oauth OAuth
		if len(info.Config.OAuth) > 0 {
			if err := decodeJSON(info.Config.OAuth, &oauth); err != nil {
				return out, err
			}
		}
		out.Connectors[entry.Slug] = Connector{Entry: entry, Config: info.Config, Auth: auth, OAuth: oauth}
	}
	for _, entry := range p.Manifest.AgentResources.Experts {
		data, err := p.ReadFile(entry.Path)
		if err != nil {
			return out, fmt.Errorf("专家 %s: %w", entry.Slug, err)
		}
		entry.SHA256 = digest(data)
		item, err := parseExpert(entry, data, &out)
		if err != nil {
			return out, err
		}
		retainedText += len(item.Prompt)
		for _, slug := range item.Skills {
			if embedded := out.Skills[slug]; embedded.ExpertPath == entry.Path {
				retainedText += len(embedded.Package.Content)
			}
		}
		if retainedText > MaxRetainedText {
			return out, fmt.Errorf("资源文本总量超限")
		}
		out.Experts[entry.Slug] = item
	}
	return out, nil
}
