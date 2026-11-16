package kb

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestMCPCreateKnowledgeBaseInput(t *testing.T) {
	for _, arguments := range []map[string]any{
		{}, {"name": "  "}, {"name": 123}, {"name": strings.Repeat("中", 67)},
		{"name": "test", "description": nil},
		{"name": "test", "ownership_type": "system"},
		{"name": "test", "owner_user_id": resource.ID()},
		{"name": "test", "grants": []any{}},
	} {
		if _, err := mcpCreateKnowledgeBaseInput(arguments); err == nil {
			t.Fatalf("accepted invalid input: %v", arguments)
		}
	}
	input, err := mcpCreateKnowledgeBaseInput(map[string]any{"name": " 我的知识库 ", "description": "说明"})
	if err != nil || input.String("name") != "我的知识库" || input.String("description") != "说明" {
		t.Fatalf("input: %v, %v", input, err)
	}
}

func TestMCPCreatePersonalKnowledgeBase(t *testing.T) {
	pool, actor := kbTestPool(t)
	s := NewService(resource.NewStore(pool), nil)
	result, err := s.callMCPTool(t.Context(), actor, json.RawMessage(`{"name":"kb_create","arguments":{"name":"MCP personal","description":"Created through MCP"}}`))
	if err != nil {
		t.Fatal(err)
	}
	item := result["structuredContent"].(resource.Object)
	var owner, ownership string
	if err := pool.QueryRow(t.Context(), `SELECT owner_user_id::text, ownership_type FROM knowledge_bases WHERE id=$1`, item.String("id")).Scan(&owner, &ownership); err != nil {
		t.Fatal(err)
	}
	if owner != actor || ownership != "user" || item.String("name") != "MCP personal" {
		t.Fatalf("unexpected owner or output: %s %s %v", owner, ownership, item)
	}
	if _, err := s.CreateUserDocument(t.Context(), actor, DocumentInput{KbID: item.String("id"), Title: "First document", Content: "body"}); err != nil {
		t.Fatalf("created KB must allow owner document writes: %v", err)
	}
}
