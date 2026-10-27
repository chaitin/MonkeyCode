package designcatalog

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
)

var pluralKinds = map[string]string{"templates": "template", "design-systems": "design-system", "styles": "style", "directions": "direction"}

func (s *Service) resourceURL(snap *Snapshot, e Entry, suffix string) string {
	q := url.Values{"snapshot": {"release:" + snap.ReleaseID}, "publisher_id": {snap.PublisherID}, "content_digest": {e.ContentDigest}}
	return s.base() + suffix + "?" + q.Encode()
}
func (s *Service) mediaURL(snap *Snapshot, e Entry, logical string) string {
	parts := strings.Split(logical, "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	group := "previews"
	if e.Kind == "style" {
		group = "style-assets"
	}
	return s.resourceURL(snap, e, "/catalog/"+group+"/"+url.PathEscape(e.ID)+"/"+strings.Join(parts, "/"))
}
func (s *Service) previewURL(snap *Snapshot, e Entry, v any) any {
	switch x := v.(type) {
	case string:
		for _, f := range e.Files {
			if f.Path == x {
				return s.mediaURL(snap, e, x)
			}
		}
		return nil
	case map[string]any:
		out := map[string]any{}
		for k, v := range x {
			if k == "path" || k == "url" || strings.HasSuffix(k, "_url") {
				out[k] = s.previewURL(snap, e, v)
			} else {
				out[k] = v
			}
		}
		return out
	case []any:
		out := make([]any, 0, len(x))
		for _, v := range x {
			out = append(out, s.previewURL(snap, e, v))
		}
		return out
	default:
		return v
	}
}
func boundPreview(value any, base string) bool {
	switch x := value.(type) {
	case string:
		return strings.HasPrefix(x, base+"/catalog/")
	case map[string]any:
		for _, v := range x {
			if boundPreview(v, base) {
				return true
			}
		}
	case []any:
		for _, v := range x {
			if boundPreview(v, base) {
				return true
			}
		}
	}
	return false
}

func (s *Service) present(snap *Snapshot, e Entry, detail bool) map[string]any {
	var metadata map[string]any
	if err := json.Unmarshal(e.Metadata, &metadata); err != nil {
		slog.Error("解析数据失败", "module", "designcatalog", "operation", "present", "error", err)
	}
	out := map[string]any{"id": e.ID, "content_digest": e.ContentDigest, "asset_snapshot_id": "release:" + snap.ReleaseID}
	fields := map[string][]string{
		"template":      {"template_kind", "downloadable", "has_skill", "name", "localizedName", "description", "localizedDescription", "mode", "category"},
		"design-system": {"name", "description", "category", "colors", "capabilities"},
		"style":         {"context", "slug", "title", "description", "variant", "category", "recommended", "localizedTitle", "localizedDescription"},
		"direction":     {"label", "localizedLabel", "prompt", "localizedPrompt", "tokens"},
	}
	for _, k := range fields[e.Kind] {
		out[k] = metadata[k]
	}
	for _, k := range []string{"name", "description", "mode", "category", "context", "slug", "title", "variant", "label"} {
		if value, ok := out[k]; ok && value == nil {
			out[k] = ""
		}
	}
	if _, ok := out["recommended"]; ok && out["recommended"] == nil {
		out["recommended"] = false
	}
	for _, k := range []string{"localizedName", "localizedDescription", "localizedTitle", "localizedLabel", "localizedPrompt"} {
		if _, ok := out[k]; ok && out[k] == nil {
			out[k] = map[string]any{}
		}
	}
	if e.Kind != "direction" {
		out["preview_url"] = nil
		preview, _ := metadata["preview"].(map[string]any)
		for _, key := range []string{"path", "url", "video_url", "image_url"} {
			if value, ok := preview[key].(string); ok {
				if target := s.previewURL(snap, e, value); target != nil {
					out["preview_url"] = target
					break
				}
			}
		}
	}
	if e.Kind == "template" {
		card := s.previewURL(snap, e, metadata["card_preview"])
		if !boundPreview(card, s.base()) {
			card = nil
		}
		out["card_preview"] = card
	}
	if !detail {
		return out
	}
	switch e.Kind {
	case "template":
		for _, key := range []string{"localizedPrompt", "examplePrompt", "skillPath"} {
			out[key] = metadata[key]
		}
		if out["localizedPrompt"] == nil {
			out["localizedPrompt"] = map[string]any{}
		}
		for _, key := range []string{"examplePrompt", "skillPath"} {
			if out[key] == nil {
				out[key] = ""
			}
		}
		out["source_skill_path"] = e.SourceSkillPath
		out["files"] = e.Files
		out["download"] = nil
		if metadata["downloadable"] == true {
			target := s.resourceURL(snap, e, "/catalog/templates/"+url.PathEscape(e.ID)+"/download")
			out["download"] = map[string]string{"url": target}
			out["download_url"] = target
		}
	case "design-system":
		for _, key := range []string{"content", "metadata"} {
			out[key] = metadata[key]
		}
		out["files"] = e.Files
		out["download_url"] = s.resourceURL(snap, e, "/design-systems/"+url.PathEscape(e.ID)+"/download")
	case "style":
		out["preview"] = s.previewURL(snap, e, metadata["preview"])
		out["files"] = e.Files
	}
	return out
}
func lookup(snap *Snapshot, kind, id, digest string) (Entry, error) {
	for _, e := range snap.Entries {
		if e.Kind == kind && e.ID == id {
			if digest != "" && digest != e.ContentDigest {
				return Entry{}, fault(409, "resource_version_mismatch", "资源摘要与所选快照不匹配")
			}
			return e, nil
		}
	}
	return Entry{}, fault(404, "resource_not_found", "资源不存在")
}
func (s *Service) detailAPI(w http.ResponseWriter, r *http.Request) {
	kind, ok := pluralKinds[pathParam(r, "kind")]
	if !ok {
		writeAPIError(w, r, fault(404, "resource_not_found", "资源类型不存在"))
		return
	}
	snap, q, err := s.selected(r)
	if err != nil {
		writeAPIError(w, r, err)
		return
	}
	e, err := lookup(snap, kind, pathParam(r, "id"), q.Get("content_digest"))
	if err != nil {
		writeAPIError(w, r, err)
		return
	}
	apiJSON(w, s.present(snap, e, true))
}
func pageValue(q url.Values, key string, defaultValue int) (int, error) {
	raw, ok := q[key]
	if !ok {
		return defaultValue, nil
	}
	n, err := strconv.ParseInt(raw[0], 10, 64)
	if err != nil || n < 1 {
		if err != nil {
			slog.Warn("操作失败", "module", "designcatalog", "operation", "pageValue", "error", err)
		}
		return 0, fault(400, "invalid_argument", "分页参数无效")
	}
	return int(n), nil
}
func termMatches(actual, requested string) bool {
	return actual == requested || strings.HasSuffix(actual, ":"+requested)
}
func matches(e Entry, q url.Values, t Taxonomy) bool {
	var meta map[string]json.RawMessage
	if err := json.Unmarshal(e.Metadata, &meta); err != nil {
		slog.Error("解析数据失败", "module", "designcatalog", "operation", "matches", "error", err)
	}
	if text := strings.ToLower(q.Get("q")); text != "" && !strings.Contains(strings.ToLower(e.ID+" "+string(e.Metadata)), text) {
		return false
	}
	for _, key := range []string{"template_kind", "context", "variant"} {
		if want := q.Get(key); want != "" && stringValue(meta[key]) != want {
			return false
		}
	}
	if want := q.Get("recommended"); want != "" && boolValue(meta["recommended"]) != (want == "true") {
		return false
	}
	for _, key := range []string{"mode", "category"} {
		want := q.Get(key)
		if want == "" {
			continue
		}
		found := termMatches(stringValue(meta[key]), want)
		if e.Kind == "template" {
			for _, rel := range t.ResourceCategories {
				if rel.ID != e.ID {
					continue
				}
				actual := rel.CategoryID
				if key == "mode" {
					actual = rel.ModeID
				}
				if termMatches(actual, want) {
					found = true
				}
			}
		}
		if !found {
			return false
		}
	}
	return true
}
func (s *Service) listAPI(w http.ResponseWriter, r *http.Request) {
	kind, ok := pluralKinds[pathParam(r, "kind")]
	if !ok {
		writeAPIError(w, r, fault(404, "resource_not_found", "资源类型不存在"))
		return
	}
	snap, q, err := s.selected(r)
	if err != nil {
		writeAPIError(w, r, err)
		return
	}
	page, err := pageValue(q, "page", 1)
	if err != nil {
		writeAPIError(w, r, err)
		return
	}
	size, err := pageValue(q, "page_size", 20)
	if err != nil {
		writeAPIError(w, r, err)
		return
	}
	size = min(size, 100)
	if value, provided := q["recommended"]; provided && value[0] != "true" && value[0] != "false" {
		writeAPIError(w, r, fault(400, "invalid_argument", "recommended 必须为 true/false"))
		return
	}
	if value := q.Get("template_kind"); value != "" && value != "bundle" && value != "prompt" {
		writeAPIError(w, r, fault(400, "invalid_argument", "template_kind 无效"))
		return
	}
	for _, filter := range []string{"mode", "category", "template_kind", "context", "variant", "recommended"} {
		if _, provided := q[filter]; !provided {
			continue
		}
		allowed := kind == "template" && (filter == "mode" || filter == "category" || filter == "template_kind") || kind == "design-system" && filter == "category" || kind == "style" && (filter == "category" || filter == "context" || filter == "variant" || filter == "recommended")
		if !allowed {
			writeAPIError(w, r, fault(400, "invalid_argument", "过滤参数不适用于资源类型"))
			return
		}
	}
	if _, ok := q["content_digest"]; ok {
		writeAPIError(w, r, fault(400, "invalid_argument", "列表不接受 content_digest"))
		return
	}
	entries := []Entry{}
	for _, e := range snap.Entries {
		if e.Kind == kind && matches(e, q, snap.Taxonomy) {
			entries = append(entries, e)
		}
	}
	slices.SortFunc(entries, func(a, b Entry) int {
		if a.CatalogRank != nil && b.CatalogRank == nil {
			return -1
		}
		if a.CatalogRank == nil && b.CatalogRank != nil {
			return 1
		}
		if a.CatalogRank != nil && b.CatalogRank != nil {
			if *a.CatalogRank < *b.CatalogRank {
				return -1
			}
			if *a.CatalogRank > *b.CatalogRank {
				return 1
			}
		}
		return strings.Compare(a.ID, b.ID)
	})
	total := len(entries)
	start := int64(total)
	if int64(page-1) <= int64(total)/int64(size) {
		start = min(int64(total), int64(page-1)*int64(size))
	}
	end := min(int64(total), start+int64(size))
	items := []map[string]any{}
	for _, e := range entries[start:end] {
		items = append(items, s.present(snap, e, false))
	}
	apiJSON(w, map[string]any{"items": items, "total": total, "page": page, "page_size": size, "total_pages": (total + size - 1) / size, "asset_snapshot_id": "release:" + snap.ReleaseID})
}
