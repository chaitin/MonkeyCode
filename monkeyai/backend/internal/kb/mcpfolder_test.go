package kb

import (
	"encoding/json"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestMCPFolderInput(t *testing.T) {
	id, parent := resource.ID(), resource.ID()
	for _, value := range []any{nil, "", "  ", parent} {
		input, err := mcpFolderInput(map[string]any{"kb_id": id, "title": " Folder ", "parent_id": value})
		if err != nil || input.KbID != id || input.Title != "Folder" || input.NodeType != "folder" || input.Content != "" {
			t.Fatalf("input=%+v err=%v", input, err)
		}
		if value == parent {
			if input.ParentID == nil || *input.ParentID != parent {
				t.Fatalf("lost parent: %+v", input)
			}
		} else if input.ParentID != nil {
			t.Fatalf("root parent must be nil: %+v", input)
		}
	}
	for _, args := range []map[string]any{
		{}, {"kb_id": id}, {"kb_id": id, "title": " "},
		{"kb_id": id, "title": "Folder", "parent_id": 1},
		{"kb_id": id, "title": "Folder", "content": "body"},
		{"kb_id": id, "title": "Folder", "node_type": "document"},
	} {
		if _, err := mcpFolderInput(args); err == nil {
			t.Fatalf("accepted invalid input: %v", args)
		}
	}
}

func TestMCPCreateNodeSchemas(t *testing.T) {
	for _, name := range []string{"kb_create_folder", "kb_create_document"} {
		var found bool
		for _, tool := range MCPTools() {
			if tool.String("name") != name {
				continue
			}
			found = true
			schema := tool["inputSchema"].(resource.Object)
			properties := schema["properties"].(resource.Object)
			if properties["parent_id"] == nil {
				t.Fatalf("%s missing parent_id", name)
			}
			for _, required := range schema["required"].([]string) {
				if required == "parent_id" {
					t.Fatalf("%s parent_id must be optional", name)
				}
				if name == "kb_create_folder" && required == "content" {
					t.Fatal("folder must not require content")
				}
			}
		}
		if !found {
			t.Fatalf("missing %s", name)
		}
	}
	parent := resource.ID()
	input, err := mcpDocumentInput(map[string]any{"kb_id": resource.ID(), "title": "Doc", "content": "body", "parent_id": parent})
	if err != nil || input.ParentID == nil || *input.ParentID != parent {
		t.Fatalf("document parent: %+v err=%v", input, err)
	}
}

func TestMCPCreateFoldersAndDocuments(t *testing.T) {
	pool, owner := kbTestPool(t)
	ctx := t.Context()
	service := NewService(resource.NewStore(pool), nil)
	id, other, editor, reader, outsider := resource.ID(), resource.ID(), resource.ID(), resource.ID(), resource.ID()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, actor := range []string{editor, reader, outsider} {
		exec(`INSERT INTO users(id,name,email) VALUES($1,'Folder user',$2)`, actor, actor+"@example.test")
	}
	exec(`INSERT INTO knowledge_bases(id,name,owner_user_id,created_by_user_id,ownership_type) VALUES($1,'Folders',$3,$3,'user'),($2,'Other',$3,$3,'user')`, id, other, owner)
	for actor, level := range map[string]string{editor: "read_write", reader: "read_only"} {
		exec(`INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb',$1,$2,$3,$4)`, id, actor, level, owner)
	}
	call := func(actor, tool string, args resource.Object, status int) resource.Object {
		t.Helper()
		params, err := json.Marshal(resource.Object{"name": tool, "arguments": args})
		if err != nil {
			t.Fatal(err)
		}
		result, err := service.callMCPTool(ctx, actor, params)
		if status != 0 {
			if err == nil || resource.AsError(err).Status != status {
				t.Fatalf("%s: err=%v want status=%d", tool, err, status)
			}
			return nil
		}
		if err != nil {
			t.Fatal(err)
		}
		return result["structuredContent"].(resource.Object)
	}
	folder := call(owner, "kb_create_folder", resource.Object{"kb_id": id, "title": "Root"}, 0)
	folderID := folder.String("id")
	if folder.String("node_type") != "folder" || folder.String("parent_id") != "" || folder.String("content") != "" {
		t.Fatalf("bad folder: %v", folder)
	}
	nested := call(editor, "kb_create_folder", resource.Object{"kb_id": id, "title": "Nested", "parent_id": folderID}, 0)
	if nested.String("parent_id") != folderID {
		t.Fatalf("bad nested folder: %v", nested)
	}
	doc := call(editor, "kb_create_document", resource.Object{"kb_id": id, "title": "Document", "content": "body", "parent_id": nested.String("id")}, 0)
	if doc.String("node_type") != "document" || doc.String("parent_id") != nested.String("id") {
		t.Fatalf("bad document: %v", doc)
	}
	rootDoc := call(owner, "kb_create_document", resource.Object{"kb_id": id, "title": "Root document", "content": "body"}, 0)
	if rootDoc.String("parent_id") != "" {
		t.Fatalf("legacy create must use root: %v", rootDoc)
	}
	foreign := call(owner, "kb_create_folder", resource.Object{"kb_id": other, "title": "Other folder"}, 0)
	for _, tool := range []string{"kb_create_folder", "kb_create_document"} {
		args := resource.Object{"kb_id": id, "title": "Child"}
		if tool == "kb_create_document" {
			args["content"] = "body"
		}
		for _, parentID := range []string{foreign.String("id"), doc.String("id"), resource.ID()} {
			args["parent_id"] = parentID
			call(owner, tool, args, 400)
		}
		args["parent_id"] = folderID
		call(reader, tool, args, 403)
		call(outsider, tool, args, 404)
	}
	var folderJobs, documentJobs int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM knowledge_base_learning_jobs WHERE document_id IN ($1,$2)`, folderID, nested.String("id")).Scan(&folderJobs); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM knowledge_base_learning_jobs WHERE document_id=$1`, doc.String("id")).Scan(&documentJobs); err != nil {
		t.Fatal(err)
	}
	if folderJobs != 0 || documentJobs != 1 {
		t.Fatalf("folder jobs=%d document jobs=%d", folderJobs, documentJobs)
	}
	exec(`UPDATE knowledge_bases SET enabled=false WHERE id=$1`, id)
	call(owner, "kb_create_folder", resource.Object{"kb_id": id, "title": "Disabled"}, 404)
	call(editor, "kb_create_document", resource.Object{"kb_id": id, "title": "Disabled", "content": "body", "parent_id": folderID}, 404)
}
