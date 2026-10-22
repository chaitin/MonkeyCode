package designcatalog

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"mime"
	"path"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/cyberphone/json-canonicalization/go/src/webpki.org/jsoncanonicalizer"
)

func Hash(b []byte) string { h := sha256.Sum256(b); return "sha256:" + hex.EncodeToString(h[:]) }
func validHash(s string) bool {
	if len(s) != 71 || !strings.HasPrefix(s, "sha256:") {
		return false
	}
	_, e := hex.DecodeString(s[7:])
	return e == nil && strings.ToLower(s) == s
}
func Canonical(b []byte) ([]byte, error) {
	if !utf8.Valid(b) || !json.Valid(b) {
		return nil, errors.New("JSON 编码无效")
	}
	return jsoncanonicalizer.Transform(b)
}
func decode(b []byte, out any) error {
	if _, err := Canonical(b); err != nil {
		return err
	}
	if err := json.Unmarshal(b, out); err != nil {
		return fmt.Errorf("JSON 字段类型错误: %w", err)
	}
	return nil
}
func canonicalHash(v any) (string, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	b, err = Canonical(b)
	if err != nil {
		return "", err
	}
	return Hash(b), nil
}

var metadataFields = map[string]string{
	"template":      "author card_preview category description downloadable examplePrompt featured featured_position has_skill localizedDescription localizedName localizedPrompt mode name platform preview profile scenario skillPath template_kind triggers",
	"design-system": "capabilities category colors content description metadata name",
	"style":         "category context description localizedDescription localizedTitle preview recommended slug title variant",
	"direction":     "label localizedLabel localizedPrompt prompt tokens",
}

func validateMetadata(e Entry) error {
	fields, ok := metadataFields[e.Kind]
	if !ok {
		return errors.New("未知设计资源类型")
	}
	var meta map[string]json.RawMessage
	if err := decode(e.Metadata, &meta); err != nil || meta == nil {
		return errors.New("metadata 必须是对象")
	}
	for key, b := range meta {
		if !slices.Contains(strings.Fields(fields), key) {
			return fmt.Errorf("metadata 不支持字段 %s", key)
		}
		var target any
		switch key {
		case "downloadable", "featured", "has_skill", "recommended":
			target = new(bool)
		case "featured_position":
			target = new(int64)
		case "triggers", "capabilities":
			target = new([]string)
		case "localizedName", "localizedDescription", "localizedTitle", "localizedLabel":
			target = new(map[string]string)
		case "localizedPrompt":
			if e.Kind == "direction" {
				target = new(map[string]json.RawMessage)
			} else {
				target = new(map[string]string)
			}
		case "profile", "preview", "card_preview", "metadata", "tokens":
			target = new(map[string]json.RawMessage)
		case "author", "colors", "prompt":
			continue
		default:
			target = new(string)
		}
		if bytes.Equal(b, []byte("null")) {
			if slices.Contains([]string{"preview", "card_preview", "profile", "metadata"}, key) {
				continue
			}
			return fmt.Errorf("metadata.%s 不接受 null", key)
		}
		if err := json.Unmarshal(b, target); err != nil {
			return fmt.Errorf("metadata.%s 类型错误", key)
		}
	}
	required := map[string][]string{"template": {"name", "template_kind", "downloadable", "has_skill"}, "design-system": {"name", "content"}, "style": {"slug", "title", "context"}, "direction": {"label", "prompt"}}
	for _, key := range required[e.Kind] {
		if _, ok := meta[key]; !ok {
			return fmt.Errorf("metadata 缺少 %s", key)
		}
	}
	if e.Kind == "template" {
		v := stringValue(meta["template_kind"])
		if v != "bundle" && v != "prompt" {
			return errors.New("template_kind 无效")
		}
	}
	dec := json.NewDecoder(bytes.NewReader(e.Metadata))
	dec.UseNumber()
	var value any
	if err := dec.Decode(&value); err != nil {
		return err
	}
	return checkNumbers(value)
}
func checkNumbers(v any) error {
	switch x := v.(type) {
	case map[string]any:
		for _, v := range x {
			if err := checkNumbers(v); err != nil {
				return err
			}
		}
	case []any:
		for _, v := range x {
			if err := checkNumbers(v); err != nil {
				return err
			}
		}
	case json.Number:
		if !strings.ContainsAny(string(x), ".eE") {
			n, ok := new(big.Int).SetString(string(x), 10)
			if !ok || n.Abs(n).Cmp(big.NewInt(9007199254740991)) > 0 {
				return errors.New("整数超出 JCS 精确范围")
			}
		}
	}
	return nil
}
func ContentDigest(e Entry) (string, error) {
	if err := validateMetadata(e); err != nil {
		return "", err
	}
	files := slices.Clone(e.Files)
	if files == nil {
		return "", errors.New("files 必须是数组")
	}
	slices.SortFunc(files, func(a, b FileRef) int { return strings.Compare(a.Path, b.Path) })
	names := map[string]bool{}
	for i, f := range files {
		if !SafePath(f.Path) || !validHash(f.SHA256) || f.Size < 0 || f.MIME == "" || len(f.MIME) > 256 || (i > 0 && f.Path == files[i-1].Path) {
			return "", errors.New("files 引用无效或重复")
		}
		if _, _, err := mime.ParseMediaType(f.MIME); err != nil {
			return "", errors.New("files MIME 无效")
		}
		names[f.Path] = true
	}
	for name := range names {
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			if names[parent] {
				return "", errors.New("逻辑源文件存在文件/目录前缀冲突")
			}
		}
	}
	metadata := e.Metadata
	var projected map[string]json.RawMessage
	if err := json.Unmarshal(e.Metadata, &projected); err != nil {
		return "", err
	}
	for _, key := range []string{"triggers", "capabilities"} {
		if raw, ok := projected[key]; ok {
			var values []string
			if err := json.Unmarshal(raw, &values); err != nil {
				return "", err
			}
			slices.Sort(values)
			for i := 1; i < len(values); i++ {
				if values[i] == values[i-1] {
					return "", errors.New("集合字段重复: " + key)
				}
			}
			projected[key] = payload(values)
		}
	}
	metadata = payload(projected)
	return canonicalHash(struct {
		Kind     string          `json:"kind"`
		ID       string          `json:"id"`
		Metadata json.RawMessage `json:"metadata"`
		Files    []FileRef       `json:"files"`
	}{e.Kind, e.ID, metadata, files})
}
func (p *Package) Digest() (string, error) {
	type item struct {
		Kind          string          `json:"kind"`
		ID            string          `json:"id"`
		ContentDigest string          `json:"content_digest"`
		Artifact      *ArtifactRef    `json:"artifact"`
		Provenance    json.RawMessage `json:"provenance,omitempty"`
		Rank          *int64          `json:"catalog_rank,omitempty"`
	}
	entries := make([]item, 0, len(p.Entries))
	for _, e := range p.Entries {
		entries = append(entries, item{e.Kind, e.ID, e.ContentDigest, e.Artifact, e.Provenance, e.CatalogRank})
	}
	slices.SortFunc(entries, func(a, b item) int { return strings.Compare(a.Kind+"\x00"+a.ID, b.Kind+"\x00"+b.ID) })
	t := p.Taxonomy
	t.Modes = slices.Clone(t.Modes)
	t.Categories = slices.Clone(t.Categories)
	t.ModeCategories = slices.Clone(t.ModeCategories)
	t.ResourceCategories = slices.Clone(t.ResourceCategories)
	slices.SortFunc(t.Modes, func(a, b Term) int { return strings.Compare(a.ID, b.ID) })
	slices.SortFunc(t.Categories, func(a, b Term) int { return strings.Compare(a.ID, b.ID) })
	slices.SortFunc(t.ModeCategories, func(a, b ModeCategory) int {
		return strings.Compare(a.ModeID+"\x00"+a.CategoryID, b.ModeID+"\x00"+b.CategoryID)
	})
	slices.SortFunc(t.ResourceCategories, func(a, b ResourceCategory) int {
		return strings.Compare(a.Kind+"\x00"+a.ID+"\x00"+a.ModeID+"\x00"+a.CategoryID, b.Kind+"\x00"+b.ID+"\x00"+b.ModeID+"\x00"+b.CategoryID)
	})
	return canonicalHash(struct {
		SnapshotRef
		Resources []item   `json:"resources"`
		Taxonomy  Taxonomy `json:"taxonomy"`
	}{p.SnapshotRef, entries, t})
}
func ManifestDigest(raw []byte) (string, error) {
	if _, err := Canonical(raw); err != nil {
		return "", err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	token, err := dec.Token()
	if err != nil || token != json.Delim('{') {
		return "", errors.New("manifest 必须是对象")
	}
	var buf bytes.Buffer
	buf.WriteByte('{')
	n := 0
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return "", err
		}
		var value json.RawMessage
		if err = dec.Decode(&value); err != nil {
			return "", err
		}
		if key.(string) == "manifest_sha256" {
			continue
		}
		if n > 0 {
			buf.WriteByte(',')
		}
		k, _ := json.Marshal(key)
		v, err := json.Marshal(value)
		if err != nil {
			return "", err
		}
		buf.Write(k)
		buf.WriteByte(':')
		buf.Write(v)
		n++
	}
	if _, err = dec.Token(); err != nil {
		return "", err
	}
	if _, err = dec.Token(); err != io.EOF {
		return "", errors.New("manifest 存在额外内容")
	}
	buf.WriteByte('}')
	return Hash(buf.Bytes()), nil
}
func stringValue(raw json.RawMessage) string { var s string; _ = json.Unmarshal(raw, &s); return s }
func boolValue(raw json.RawMessage) bool     { return bytes.Equal(raw, []byte("true")) }
