package setting

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

type memoryStore struct {
	records map[string]Record
}

func (m *memoryStore) Get(_ context.Context, key string) (Record, error) {
	record, ok := m.records[key]
	if !ok {
		return Record{}, ErrNotFound
	}
	return record, nil
}

func (m *memoryStore) List(context.Context) ([]Record, error) {
	records := make([]Record, 0, len(m.records))
	for _, record := range m.records {
		records = append(records, record)
	}
	return records, nil
}

func (m *memoryStore) Put(_ context.Context, record Record) (Record, error) {
	record.UpdatedAt = time.Now()
	m.records[record.Key] = record
	return record, nil
}

func TestAgentConfigRedactsSecrets(t *testing.T) {
	store := &memoryStore{records: map[string]Record{
		"authentication": {
			Key:       "authentication",
			Value:     json.RawMessage(`{"oauth_connections":[{"id":"github","client_id":"client","client_secret":"secret"}]}`),
			UpdatedAt: time.Now(),
		},
		"email": {
			Key: "email", Value: json.RawMessage(`{"smtp_host":"smtp.example.com","smtp_password":"secret"}`), UpdatedAt: time.Now(),
		},
	}}
	service := NewService(store)
	config, err := service.AgentConfig(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(config)
	if string(encoded) == "" || strings.Contains(string(encoded), "secret") {
		t.Fatalf("Agent 配置泄漏密钥: %s", encoded)
	}
}

func TestPutPreservesRedactedSecret(t *testing.T) {
	store := &memoryStore{records: map[string]Record{
		"authentication": {Key: "authentication", Value: json.RawMessage(`{"oauth_connections":[{"id":"github","provider":"github","name":"GitHub","client_id":"client","client_secret":"secret","enabled":true}]}`)},
	}}
	service := NewService(store)
	_, err := service.Put(t.Context(), "authentication", json.RawMessage(`{"oauth_connections":[{"id":"github","provider":"github","name":"GitHub","client_id":"client","enabled":true}]}`), 1, "user")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(store.records["authentication"].Value), "secret") {
		t.Fatalf("密钥未被保留: %s", store.records["authentication"].Value)
	}
}

func TestOAuthIDs(t *testing.T) {
	store := &memoryStore{records: map[string]Record{}}
	service := NewService(store)
	input := json.RawMessage(`{"oauth_connections":[{"provider":"github","name":"GitHub","client_id":"github-client","client_secret":"github-secret","enabled":true},{"id":"","provider":"gitlab","name":"GitLab","client_id":"gitlab-client","client_secret":"gitlab-secret","enabled":true}]}`)
	if _, err := service.Put(t.Context(), "authentication", input, 1, "user"); err != nil {
		t.Fatal(err)
	}
	read := func() []map[string]any {
		t.Helper()
		record, err := service.AdminGet(t.Context(), "authentication")
		if err != nil {
			t.Fatal(err)
		}
		var value struct {
			Connections []map[string]any `json:"oauth_connections"`
		}
		if err := json.Unmarshal(record.Value, &value); err != nil {
			t.Fatal(err)
		}
		return value.Connections
	}
	connections := read()
	first, second := stringAny(connections[0]["id"]), stringAny(connections[1]["id"])
	if first == "" || second == "" || first == second {
		t.Fatalf("服务端应为每个新连接生成独立标识: %v", connections)
	}
	for _, connection := range connections {
		if _, ok := connection["client_secret"]; ok {
			t.Fatal("响应不应包含密钥")
		}
	}
	connections[0]["enabled"] = false
	connections[0]["name"] = "更新后的 GitHub"
	update, _ := json.Marshal(map[string]any{"oauth_connections": connections})
	if _, err := service.Put(t.Context(), "authentication", update, 1, "user"); err != nil {
		t.Fatal(err)
	}
	connections = read()
	if connections[0]["id"] != first || connections[1]["id"] != second || connections[0]["enabled"] != false {
		t.Fatalf("更新应保留已有标识: %v", connections)
	}
	stored := string(store.records["authentication"].Value)
	if !strings.Contains(stored, "github-secret") || !strings.Contains(stored, "gitlab-secret") {
		t.Fatal("使用服务端标识更新时应保留原有密钥")
	}
	for _, raw := range []string{`[null]`, `[{"id":3}]`, `[{"id":null}]`} {
		if _, err := service.Put(t.Context(), "authentication", json.RawMessage(`{"oauth_connections":`+raw+`}`), 1, "user"); err == nil {
			t.Fatalf("无效连接应被拒绝: %s", raw)
		}
	}
}
