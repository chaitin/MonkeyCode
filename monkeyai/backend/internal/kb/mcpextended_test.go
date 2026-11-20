package kb

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestMCPExtendedArguments(t *testing.T) {
	service := &Service{}
	for _, tc := range []struct {
		name string
		args resource.Object
	}{
		{"kb_get", resource.Object{}},
		{"kb_get", resource.Object{"kb_id": 1}},
		{"kb_list_tags", resource.Object{"owner": "all"}},
		{"kb_list_permissions", resource.Object{}},
		{"kb_get_image", resource.Object{}},
		{"kb_get_image", resource.Object{"kb_id": resource.ID(), "name": "../../other.png"}},
		{"kb_update", resource.Object{"kb_id": resource.ID(), "name": "new", "ownership_type": "system"}},
		{"kb_update", resource.Object{"kb_id": resource.ID(), "name": "new", "expected_revision": 0}},
		{"kb_update", resource.Object{"kb_id": resource.ID(), "name": "new", "expected_revision": 1.5}},
		{"kb_update", resource.Object{"kb_id": resource.ID(), "name": strings.Repeat("中", 67), "expected_revision": 1}},
		{"kb_update", resource.Object{"kb_id": resource.ID(), "name": "new", "expected_revision": 1, "avatar_base64": "data:image/png;base64,YQ=="}},
		{"kb_update", resource.Object{"kb_id": resource.ID(), "name": "new", "expected_revision": 1, "fusion_config": nil}},
		{"kb_move_document", resource.Object{"kb_id": resource.ID()}},
		{"kb_move_document", resource.Object{"kb_id": resource.ID(), "document_id": resource.ID(), "expected_revision": -1}},
		{"kb_restudy_document", resource.Object{"document_id": resource.ID()}},
		{"kb_restudy_document", resource.Object{"kb_id": resource.ID(), "document_id": resource.ID(), "parent_id": resource.ID()}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			params, err := json.Marshal(resource.Object{"name": tc.name, "arguments": tc.args})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := service.callMCPTool(t.Context(), "actor", params); err == nil {
				t.Fatalf("accepted invalid arguments: %v", tc.args)
			}
		})
	}
}

func TestMCPKnowledgeBaseUpdateRequestLimit(t *testing.T) {
	for _, tc := range []struct {
		size    int
		allowed bool
	}{{1 << 20, true}, {mcpAvatarRequestLimit, false}} {
		body, err := json.Marshal(resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": resource.Object{
			"name": "kb_update", "arguments": resource.Object{"kb_id": resource.ID(), "name": "KB", "expected_revision": 1, "avatar_base64": strings.Repeat("A", tc.size)},
		}})
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := readMCPRequest(httptest.NewRecorder(), httptest.NewRequest("POST", "/mcp/kb", bytes.NewReader(body))); ok != tc.allowed {
			t.Fatalf("size=%d allowed=%v", tc.size, ok)
		}
	}
}

func TestMCPExtendedKnowledgeBaseTools(t *testing.T) {
	pool, owner := kbTestPool(t)
	ctx := t.Context()
	storage := &assetTestStorage{&avatarStorage{files: map[string][]byte{}}}
	service := NewService(resource.NewStore(pool), nil).WithStorage(storage)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	editor, reader, outsider := resource.ID(), resource.ID(), resource.ID()
	for _, actor := range []string{editor, reader, outsider} {
		exec(`INSERT INTO users(id,name,email) VALUES($1,'MCP user',$2)`, actor, actor+"@example.test")
	}
	id, foreign := resource.ID(), resource.ID()
	exec(`INSERT INTO knowledge_bases(id,name,owner_user_id,created_by_user_id,ownership_type) VALUES($1,'MCP tools',$2,$2,'user'),($3,'Foreign',$4,$4,'user')`, id, owner, foreign, outsider)
	for actor, level := range map[string]string{editor: "read_write", reader: "read_only"} {
		exec(`INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb',$1,$2,$3,$4)`, id, actor, level, owner)
	}
	// Exercise the actual MCP HTTP envelope, including image content and business errors.
	call := func(actor, name string, arguments resource.Object, status int) resource.Object {
		t.Helper()
		params, err := json.Marshal(resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": resource.Object{"name": name, "arguments": arguments}})
		if err != nil {
			t.Fatal(err)
		}
		router := chi.NewRouter()
		service.RegisterMCP(router, testMCPKeys{token: "key", scope: "mcp:invoke", user: actor})
		req := httptest.NewRequest("POST", "/mcp/kb", bytes.NewReader(params))
		req.Header.Set("Authorization", "Bearer key")
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		var reply struct {
			Result resource.Object `json:"result"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &reply); err != nil {
			t.Fatal(err)
		}
		failed, _ := reply.Result["isError"].(bool)
		if w.Code != http.StatusOK || failed != (status != 0) {
			t.Fatalf("%s actor=%s: %d %s", name, actor, w.Code, w.Body.String())
		}
		if status != 0 {
			// Also check the original business status; the MCP transport always returns 200.
			params, _ := json.Marshal(resource.Object{"name": name, "arguments": arguments})
			_, err := service.callMCPTool(ctx, actor, params)
			if err == nil || resource.AsError(err).Status != status {
				t.Fatalf("%s status: %v, want %d", name, err, status)
			}
		}
		return reply.Result
	}
	structured := func(result resource.Object) resource.Object {
		return resource.Object(result["structuredContent"].(map[string]any))
	}
	for _, actor := range []string{owner, editor, reader} {
		book := structured(call(actor, "kb_get", resource.Object{"kb_id": id}, 0))
		if book.String("id") != id || book["permissions"] == nil || book["revision"] == nil {
			t.Fatalf("missing detail fields: %v", book)
		}
		_, hasGrants := book["grants"]
		if hasGrants != (actor == owner) {
			t.Fatalf("detail grants visibility actor=%s: %v", actor, book)
		}
	}
	call(outsider, "kb_get", resource.Object{"kb_id": id}, 404)
	grants := structured(call(owner, "kb_list_permissions", resource.Object{"kb_id": id}, 0))
	if len(grants["grants"].([]any)) != 2 || grants["revision"] == nil {
		t.Fatalf("bad grants: %v", grants)
	}
	for _, actor := range []string{reader, editor, outsider} {
		call(actor, "kb_list_permissions", resource.Object{"kb_id": id}, 404)
	}

	visibleTag, hiddenTag := resource.ID(), resource.ID()
	exec(`INSERT INTO tags(id,name,created_by_user_id) VALUES($1,'Visible',$3),($2,'Hidden',$3)`, visibleTag, hiddenTag, owner)
	exec(`INSERT INTO resource_tags(resource_type,resource_id,tag_id,assigned_by_user_id) VALUES('kb',$1,$2,$5),('kb',$3,$4,$5)`, id, visibleTag, foreign, hiddenTag, owner)
	tags := structured(call(reader, "kb_list_tags", resource.Object{}, 0))["tags"].([]any)
	if len(tags) != 1 || tags[0].(map[string]any)["id"] != visibleTag {
		t.Fatalf("tag visibility: %v", tags)
	}

	update := resource.Object{"kb_id": id, "name": "Updated", "description": "MCP description", "expected_revision": 1}
	call(owner, "kb_update", resource.Object{"kb_id": id, "name": "Invalid"}, 428)
	call(editor, "kb_update", update, 404)
	updated := structured(call(owner, "kb_update", update, 0))
	if updated.String("name") != "Updated" || updated.String("description") != "MCP description" || updated["revision"] != float64(2) {
		t.Fatalf("bad update: %v", updated)
	}
	call(owner, "kb_update", update, 412)
	delete(update, "description")
	update["expected_revision"] = 2
	update["avatar_base64"] = base64.StdEncoding.EncodeToString(avatarImage(t, "png"))
	update["tag_ids"] = []string{}
	update["fusion_config"] = resource.Object{"type": "weighted_rrf", "k": 40, "weights": resource.Object{"lexical": 0.5, "vector": 0.5}}
	updated = structured(call(owner, "kb_update", update, 0))
	if updated.String("avatar_path") == "" || len(updated["tags"].([]any)) != 0 || updated["fusion_config"].(map[string]any)["k"] != float64(40) {
		t.Fatalf("metadata update: %v", updated)
	}
	if updated.String("description") != "MCP description" {
		t.Fatalf("metadata update cleared omitted description: %v", updated)
	}
	cleared := structured(call(owner, "kb_update", resource.Object{
		"kb_id": id, "name": "Updated", "description": "", "expected_revision": updated["revision"],
	}, 0))
	if cleared.String("description") != "" {
		t.Fatalf("explicit empty description was not cleared: %v", cleared)
	}
	stored, err := service.Get(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if stored.String("description") != "" {
		t.Fatalf("empty description was not persisted: %v", stored)
	}

	upload := structured(call(owner, "kb_upload_image", resource.Object{"kb_id": id, "data_base64": base64.StdEncoding.EncodeToString(avatarImage(t, "png"))}, 0))
	for _, actor := range []string{owner, reader, editor} {
		book := structured(call(actor, "kb_get", resource.Object{"kb_id": id}, 0))
		if book.String("avatar_path") != updated.String("avatar_path") || !strings.HasPrefix(book.String("avatar_path"), "/api/v1/kb/"+id+"/avatar?") {
			t.Fatalf("detail avatar path: %v", book)
		}
		if strings.Contains(string(mustMarshalMCP(t, book)), "avatar_s3_key") {
			t.Fatal("detail exposed storage key")
		}
		result := call(actor, "kb_get_image", resource.Object{"kb_id": id, "name": upload.String("name")}, 0)
		content := result["content"].([]any)
		image := content[1].(map[string]any)
		data, err := base64.StdEncoding.DecodeString(image["data"].(string))
		if err != nil || image["type"] != "image" || image["mimeType"] != "image/png" || !bytes.Equal(data, avatarImage(t, "png")) {
			t.Fatalf("bad MCP image: %v", image)
		}
	}
	call(outsider, "kb_get_image", resource.Object{"kb_id": id, "name": upload.String("name")}, 404)
	call(owner, "kb_get", resource.Object{"kb_id": foreign}, 404) // Admin role does not bypass MCP grants.

	folder, err := service.CreateUserDocument(ctx, owner, DocumentInput{KbID: id, Title: "Folder", NodeType: "folder"})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := service.CreateUserDocument(ctx, owner, DocumentInput{KbID: id, Title: "Document", Content: "body"})
	if err != nil {
		t.Fatal(err)
	}
	docID := doc.String("id")
	exec(`INSERT INTO knowledge_base_chunks(kb_id,document_id,chunk_index,content) VALUES($1,$2,0,'MCP chunk')`, id, docID)
	docArgs := resource.Object{"kb_id": id, "document_id": docID}
	for _, tool := range []string{"kb_move_document", "kb_restudy_document"} {
		call(owner, tool, resource.Object{"kb_id": foreign, "document_id": docID}, 404)
	}
	call(reader, "kb_move_document", docArgs, 403)
	call(reader, "kb_restudy_document", docArgs, 403)
	call(editor, "kb_move_document", docArgs, 428)
	move := resource.Object{"kb_id": id, "document_id": docID, "parent_id": folder.String("id"), "expected_revision": doc["revision"]}
	moved := structured(call(editor, "kb_move_document", move, 0))
	if moved.String("parent_id") != folder.String("id") {
		t.Fatalf("move: %v", moved)
	}
	call(editor, "kb_move_document", move, 412)
	call(owner, "kb_move_document", resource.Object{"kb_id": id, "document_id": folder.String("id"), "parent_id": folder.String("id")}, 400)
	call(owner, "kb_restudy_document", resource.Object{"kb_id": id, "document_id": folder.String("id")}, 400)
	// No chunks means restudy must enqueue exactly one active replacement job.
	exec(`DELETE FROM knowledge_base_chunks WHERE document_id=$1`, docID)
	call(editor, "kb_restudy_document", docArgs, 0)
	call(editor, "kb_restudy_document", docArgs, 0)
	var jobs int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM knowledge_base_learning_jobs WHERE document_id=$1 AND status IN ('pending','running')`, docID).Scan(&jobs); err != nil || jobs != 1 {
		t.Fatalf("restudy jobs=%d err=%v", jobs, err)
	}
	// Revocation and disabling must apply to every subsequent MCP read and write.
	exec(`DELETE FROM resource_access_grants WHERE resource_id=$1 AND user_id=$2`, id, editor)
	call(editor, "kb_restudy_document", docArgs, 404)
	call(editor, "kb_read_document", docArgs, 404)
	exec(`UPDATE knowledge_bases SET enabled=false WHERE id=$1`, id)
	call(owner, "kb_get", resource.Object{"kb_id": id}, 404)
	call(reader, "kb_read_document", docArgs, 404)
	call(owner, "kb_get_image", resource.Object{"kb_id": id, "name": upload.String("name")}, 404)
	call(owner, "kb_move_document", docArgs, 404)
	call(owner, "kb_restudy_document", docArgs, 404)
}

func mustMarshalMCP(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
