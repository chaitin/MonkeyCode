package resource

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource/sqlc"
)

func tagsFor(item Object) []Object {
	tags, _ := item["tags"].([]Object)
	return tags
}

func CollectTags(items []Object) []Object {
	out := []Object{}
	seen := map[string]bool{}
	for _, item := range items {
		for _, tag := range tagsFor(item) {
			if !seen[tag.String("id")] {
				out = append(out, tag)
				seen[tag.String("id")] = true
			}
		}
	}
	slices.SortFunc(out, func(a, b Object) int {
		if n := strings.Compare(strings.ToLower(a.String("name")), strings.ToLower(b.String("name"))); n != 0 {
			return n
		}
		return strings.Compare(a.String("id"), b.String("id"))
	})
	return out
}

func QueryTagIDs(r *http.Request) []string {
	var ids []string
	seen := map[string]bool{}
	for _, key := range []string{"tag_id", "tag_ids"} {
		for _, value := range r.URL.Query()[key] {
			for part := range strings.SplitSeq(value, ",") {
				id := strings.TrimSpace(part)
				if id != "" && !seen[id] {
					ids = append(ids, id)
					seen[id] = true
				}
			}
		}
	}
	return ids
}

func FilterTags(items []Object, ids []string) []Object {
	if len(ids) == 0 {
		return items
	}
	wanted := make(map[string]bool, len(ids))
	for _, id := range ids {
		wanted[id] = true
	}
	out := []Object{}
	for _, item := range items {
		for _, tag := range tagsFor(item) {
			if wanted[tag.String("id")] {
				out = append(out, item)
				break
			}
		}
	}
	return out
}

func Tags(ctx context.Context, q Queryer, kind, id string) ([]Object, error) {
	return DecodeObjects(sqlc.New(q).ResourceTags(ctx, sqlc.ResourceTagsParams{ResourceType: kind, ResourceID: id}))
}

// SaveTags leaves existing links untouched when tag_ids is absent.
func SaveTags(ctx context.Context, q Queryer, kind, id, actor string, raw any) error {
	data, err := json.Marshal(raw)
	if err != nil {
		return Invalid("标签格式无效")
	}
	var ids []string
	if string(data) == "null" || json.Unmarshal(data, &ids) != nil {
		return Invalid("tag_ids 必须是标签 ID 数组")
	}
	queries := sqlc.New(q)
	if err := queries.RemoveResourceTags(ctx, sqlc.RemoveResourceTagsParams{ResourceType: kind, ResourceID: id}); err != nil {
		return err
	}
	seen := make(map[string]bool, len(ids))
	for _, tag := range ids {
		if seen[tag] {
			continue
		}
		seen[tag] = true
		result, err := queries.AddResourceTag(ctx, sqlc.AddResourceTagParams{ResourceType: kind, ResourceID: id, TagID: tag, ActorID: actor})
		if err != nil {
			return err
		}
		if result.RowsAffected() != 1 {
			return Invalid("标签不存在或已删除")
		}
	}
	return nil
}
