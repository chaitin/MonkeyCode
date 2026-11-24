package kb

import (
	"bytes"
	"encoding/json"
	"github.com/go-chi/chi/v5"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestTextEdits(t *testing.T) {
	for _, tc := range []struct {
		name, original string
		edits          []textEdit
		want, code     string
	}{
		{"unicode", "日期：今天。", []textEdit{{"今天", "明天"}}, "日期：明天。", ""},
		{"sequential", "abc", []textEdit{{"b", "xy"}, {"xyc", "z"}}, "az", ""},
		{"delete all", "abc", []textEdit{{"abc", ""}}, "", ""},
		{"ambiguous", "abc abc", []textEdit{{"abc", "x"}}, "", "ambiguous_match"},
		{"overlapping", "aaa", []textEdit{{"aa", "x"}}, "", "ambiguous_match"},
		{"missing", "abc", []textEdit{{"d", "x"}}, "", "text_not_found"},
		{"empty old", "abc", []textEdit{{"", "x"}}, "", "invalid_request"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := applyTextEdits(tc.original, tc.edits)
			if tc.code != "" {
				if err == nil {
					t.Fatal("expected failure")
				}
				if tc.code != "invalid_request" && resource.AsError(err).Code != tc.code {
					t.Fatal(err)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("got %q, %v", got, err)
			}
		})
	}
	for _, raw := range []string{`{"old_text":"a"}`, `{"old_text":"a","new_text":null}`, `{"old_text":"a","new_text":"b","extra":true}`} {
		var edit textEdit
		if json.Unmarshal([]byte(raw), &edit) == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	if got := countOverlapping("aaaa", "aa"); got != 3 {
		t.Fatalf("overlapping count = %d", got)
	}
	if _, err := applyTextEdits("aaaa", []textEdit{{"aa", "x"}}); err == nil || !strings.Contains(err.Error(), "匹配 3 次") {
		t.Fatalf("overlap message: %v", err)
	}
	var decoded struct {
		Edits []textEdit `json:"edits"`
	}
	err := decodeMCPArguments(map[string]any{"edits": []any{map[string]any{"old_text": "a"}}}, &decoded)
	if err == nil || !strings.Contains(err.Error(), "old_text 和 new_text") {
		t.Fatalf("edit validation detail lost: %v", err)
	}
	if _, err := applyTextEdits("a", []textEdit{{"a", strings.Repeat("x", maxMCPEditBytes)}}); err == nil {
		t.Fatal("unbounded edit")
	}
}

func TestTextPage(t *testing.T) {
	p, err := textPage("a中文🙂z", 1, 3)
	if err != nil || p.String("content") != "中文🙂" || p["next_offset"] != 4 {
		t.Fatalf("%v %v", p, err)
	}
	p, err = textPage("a中文🙂z", 5, 3)
	if err != nil || p["next_offset"] != nil || p["has_more"] != false {
		t.Fatalf("%v %v", p, err)
	}
	for _, pair := range [][2]int{{-1, 1}, {6, 1}, {0, 0}, {0, mcpTextPageMax + 1}} {
		if _, err := textPage("a中文🙂z", pair[0], pair[1]); err == nil {
			t.Fatal(pair)
		}
	}
}

func TestMCPEditDocumentTransaction(t *testing.T) {
	pool, owner := kbTestPool(t)
	ctx := t.Context()
	service := NewService(resource.NewStore(pool), nil)
	book, err := service.CreateUserKB(ctx, owner, resource.Object{"name": "edit test"})
	if err != nil {
		t.Fatal(err)
	}
	doc, err := service.CreateUserDocument(ctx, owner, DocumentInput{KbID: book.String("id"), Title: "original", Content: "第一段。第二段。"})
	if err != nil {
		t.Fatal(err)
	}
	call := func(name string, args resource.Object) (resource.Object, error) {
		t.Helper()
		raw, err := json.Marshal(resource.Object{"name": name, "arguments": args})
		if err != nil {
			t.Fatal(err)
		}
		result, err := service.callMCPTool(ctx, owner, raw)
		if err != nil {
			return nil, err
		}
		return result["structuredContent"].(resource.Object), nil
	}
	reader := resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,'reader',$2)`, reader, reader+"@example.test"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb',$1,$2,'read_only',$3)`, book.String("id"), reader, owner); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(resource.Object{"name": "kb_edit_document", "arguments": resource.Object{"kb_id": book.String("id"), "document_id": doc.String("id"), "expected_revision": doc["revision"], "edits": []textEdit{{"第一段", "新段"}}}})
	if _, err := service.callMCPTool(ctx, reader, raw); resource.AsError(err).Status != 403 {
		t.Fatalf("read-only edit: %v", err)
	}
	router := chi.NewRouter()
	service.RegisterMCP(router, testMCPKeys{token: "test-token", scope: "mcp:invoke", user: owner})
	body, _ := json.Marshal(resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": resource.Object{"name": "kb_read_document", "arguments": resource.Object{"kb_id": book.String("id"), "document_id": doc.String("id"), "limit": 4}}})
	req := httptest.NewRequest("POST", "/mcp/kb", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-token")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	var reply struct {
		Result struct {
			Structured struct {
				Content string `json:"content"`
			} `json:"structuredContent"`
		} `json:"result"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &reply); err != nil || response.Code != 200 || reply.Result.Structured.Content != "第一段。" {
		t.Fatalf("HTTP read: %s %v", response.Body.String(), err)
	}

	args := resource.Object{"kb_id": book.String("id"), "document_id": doc.String("id"), "expected_revision": doc["revision"], "edits": []textEdit{{"第一段", "新段"}, {"不存在", "x"}}}
	if _, err := call("kb_edit_document", args); resource.AsError(err).Code != "text_not_found" {
		t.Fatalf("%v", err)
	}
	unchanged, err := service.GetDocument(ctx, doc.String("id"))
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.String("content") != doc.String("content") || objectInt64(unchanged["revision"]) != objectInt64(doc["revision"]) {
		t.Fatal("partial write", unchanged)
	}
	args["edits"] = []textEdit{{"第一段", "新段"}}
	updated, err := call("kb_edit_document", args)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := updated["content"]; ok {
		t.Fatal("edit echoed content")
	}
	if _, err := call("kb_edit_document", args); resource.AsError(err).Code != "document_revision_conflict" {
		t.Fatalf("stale replay: %v", err)
	}
	if _, err := call("kb_read_document", resource.Object{"kb_id": book.String("id"), "document_id": doc.String("id"), "offset": 1, "expected_revision": doc["revision"]}); resource.AsError(err).Code != "document_revision_conflict" {
		t.Fatalf("mixed revision: %v", err)
	}
	args["expected_revision"] = updated["revision"]
	args["edits"] = []textEdit{{"新段。第二段。", ""}}
	if _, err := call("kb_edit_document", args); err != nil {
		t.Fatal(err)
	}
	empty, err := service.GetDocument(ctx, doc.String("id"))
	if err != nil || empty.String("content") != "" {
		t.Fatalf("clear: %v %v", empty, err)
	}

	fileDoc, err := service.CreateUserDocument(ctx, owner, DocumentInput{KbID: book.String("id"), Title: "file", SourceType: "file", FileName: "a.txt", MimeType: "text/plain", Content: "文件正文"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := call("kb_edit_document", resource.Object{"kb_id": book.String("id"), "document_id": fileDoc.String("id"), "expected_revision": fileDoc["revision"], "edits": []textEdit{{"文件", "x"}}}); err == nil || !strings.Contains(resource.AsError(err).Message, "仅文本文档") {
		t.Fatalf("file edit: %v", err)
	}
	folder, err := service.CreateUserDocument(ctx, owner, DocumentInput{KbID: book.String("id"), Title: "folder", NodeType: "folder"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := call("kb_read_document", resource.Object{"kb_id": book.String("id"), "document_id": folder.String("id")}); err == nil || !strings.Contains(resource.AsError(err).Message, "文件夹") {
		t.Fatalf("folder read: %v", err)
	}

	result, err := call("kb_update", resource.Object{"kb_id": book.String("id"), "expected_revision": book["revision"], "description": "new description"})
	if err != nil || result.String("name") != "edit test" || result.String("description") != "new description" {
		t.Fatalf("metadata patch: %v %v", result, err)
	}
}
