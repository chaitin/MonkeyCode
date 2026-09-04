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
	service := NewService(store, NewBroker())
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
	service := NewService(store, NewBroker())
	_, err := service.Put(t.Context(), "authentication", json.RawMessage(`{"oauth_connections":[{"id":"github","provider":"github","name":"GitHub","client_id":"client","enabled":true}]}`), 1, "user")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(store.records["authentication"].Value), "secret") {
		t.Fatalf("密钥未被保留: %s", store.records["authentication"].Value)
	}
}
