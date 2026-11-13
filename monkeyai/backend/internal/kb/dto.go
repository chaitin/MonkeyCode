package kb

import (
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"strings"
)

var kbPublicFields = []string{
	"id", "name", "avatar_path", "description", "ownership_type", "enabled", "revision",
	"fusion_config", "embedding_model_id",
	"embedding_dimension", "embedding_configured", "capabilities", "permissions",
	"index_job_summary", "document_count", "learned_count", "tags", "updated_at",
}

var documentPublicFields = []string{
	"id", "kb_id", "parent_id", "node_type", "position", "title", "source_type", "content", "file_name", "mime_type",
	"size_bytes", "status", "error_message", "chunk_count", "revision",
	"learned_at", "created_at", "updated_at", "updated_by_user_id", "content_updated_at", "children",
}

var documentListPublicFields = []string{
	"id", "kb_id", "parent_id", "node_type", "position", "title", "source_type", "file_name", "mime_type",
	"size_bytes", "status", "error_message", "chunk_count", "revision",
	"learned_at", "created_at", "updated_at", "updated_by_user_id", "content_updated_at", "children",
}

func publicKB(item resource.Object) resource.Object {
	out := project(item, kbPublicFields)
	if path := out.String("avatar_path"); path != "" {
		out["avatar_path"] = strings.Replace(path, "/api/admin/v1/", "/api/v1/", 1)
	}
	if _, ok := out["capabilities"]; !ok {
		decorateRetrievalCapabilities(out)
	}
	return out
}

func publicKBList(item resource.Object, viewer string) resource.Object {
	out := publicKB(item)
	if owner, ok := item["user"]; ok {
		out["user"] = owner
	} else {
		out["user"] = resource.User{}
	}
	if !kbOwnedBy(item, viewer) {
		return out
	}
	if shared, ok := item["shared_users"]; ok {
		out["shared_users"] = shared
	}
	if groups, ok := item["shared_groups"]; ok {
		out["shared_groups"] = groups
	}
	return out
}

func publicKBDetail(item resource.Object, viewer string) resource.Object {
	out := publicKBList(item, viewer)
	if !kbOwnedBy(item, viewer) {
		return out
	}
	if grants, ok := item["grants"]; ok {
		out["grants"] = grants
	}
	return out
}

func kbOwnedBy(item resource.Object, viewer string) bool {
	owner, ok := item["user"].(resource.User)
	return ok && item.String("ownership_type") == "user" && owner.ID == viewer
}

func publicDocument(item resource.Object) resource.Object {
	return project(item, documentPublicFields)
}

func publicDocumentSummary(item resource.Object) resource.Object {
	return project(item, documentListPublicFields)
}

func project(item resource.Object, fields []string) resource.Object {
	out := resource.Object{}
	for _, field := range fields {
		if value, ok := item[field]; ok {
			out[field] = value
		}
	}
	return out
}
