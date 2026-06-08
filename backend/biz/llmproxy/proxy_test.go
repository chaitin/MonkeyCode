package llmproxy

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/pkg/modelusage"
)

func newProxyTestDB(t *testing.T) *db.Client {
	t.Helper()
	client := enttest.Open(t, "sqlite3", "file:llmproxy-test?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func seedProxyModel(t *testing.T, client *db.Client, upstreamURL string) string {
	t.Helper()
	key, _, _, _ := seedProxyModelWithTask(t, client, upstreamURL)
	return key
}

func seedProxyModelWithTask(t *testing.T, client *db.Client, upstreamURL string) (string, uuid.UUID, uuid.UUID, string) {
	t.Helper()
	ctx := context.Background()
	userID := uuid.New()
	modelID := uuid.New()
	taskID := uuid.New()
	hostID := "host-" + uuid.NewString()
	vmID := "vm-" + uuid.NewString()
	key := "runtime-" + uuid.NewString()

	if _, err := client.User.Create().
		SetID(userID).
		SetName("user").
		SetRole(consts.UserRoleIndividual).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Model.Create().
		SetID(modelID).
		SetUserID(userID).
		SetProvider("OpenAI").
		SetAPIKey("real-model-key").
		SetBaseURL(upstreamURL).
		SetModel("gpt-4o").
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Task.Create().
		SetID(taskID).
		SetKind(consts.TaskTypeDevelop).
		SetContent("hi").
		SetUserID(userID).
		SetStatus(consts.TaskStatusProcessing).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Host.Create().
		SetID(hostID).
		SetUserID(userID).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.VirtualMachine.Create().
		SetID(vmID).
		SetHostID(hostID).
		SetUserID(userID).
		SetName(vmID).
		SetCores(2).
		SetMemory(8 << 30).
		SetAccessToken(vmID).
		SetExpiredAt(time.Now().Add(time.Hour)).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TaskVirtualMachine.Create().
		SetID(uuid.New()).
		SetTaskID(taskID).
		SetVirtualmachineID(vmID).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.ModelApiKey.Create().
		SetID(uuid.New()).
		SetUserID(userID).
		SetModelID(modelID).
		SetVirtualmachineID(vmID).
		SetAPIKey(key).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	return key, userID, taskID, modelID.String()
}

type usageRecorderStub struct {
	mu     sync.Mutex
	events []modelusage.Event
}

func (s *usageRecorderStub) Record(ctx context.Context, event modelusage.Event) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, event)
	return nil
}

func (s *usageRecorderStub) waitForEvents(t *testing.T, want int) []modelusage.Event {
	t.Helper()
	deadline := time.After(time.Second)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		s.mu.Lock()
		events := append([]modelusage.Event(nil), s.events...)
		s.mu.Unlock()
		if len(events) >= want {
			return events
		}
		select {
		case <-deadline:
			t.Fatalf("usage events = %d, want %d", len(events), want)
		case <-ticker.C:
		}
	}
}

func TestProxyForwardsRuntimeKeyToUpstreamModel(t *testing.T) {
	var gotPath string
	var gotAuth string
	var gotBody string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		gotBody = string(body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"chatcmpl_test","choices":[{"message":{"content":"ok"}}]}`))
	}))
	t.Cleanup(upstream.Close)

	client := newProxyTestDB(t)
	runtimeKey := seedProxyModel(t, client, upstream.URL+"/v1")
	proxy := NewProxy(client, slog.New(slog.NewTextHandler(io.Discard, nil)))

	body := `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+runtimeKey)
	rec := httptest.NewRecorder()

	proxy.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if gotPath != "/v1/chat/completions" {
		t.Fatalf("upstream path = %q", gotPath)
	}
	if gotAuth != "Bearer real-model-key" {
		t.Fatalf("upstream auth = %q", gotAuth)
	}
	if gotBody != body {
		t.Fatalf("upstream body = %q", gotBody)
	}
}

func TestProxyRecordsChatCompletionUsage(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"id":"chatcmpl_test",
			"choices":[{"message":{"content":"ok"}}],
			"usage":{
				"prompt_tokens":11,
				"completion_tokens":7,
				"total_tokens":18,
				"prompt_tokens_details":{"cached_tokens":5}
			}
		}`))
	}))
	t.Cleanup(upstream.Close)

	client := newProxyTestDB(t)
	runtimeKey, userID, taskID, modelID := seedProxyModelWithTask(t, client, upstream.URL+"/v1")
	recorder := &usageRecorderStub{}
	proxy := NewProxy(client, slog.New(slog.NewTextHandler(io.Discard, nil)), WithUsageRecorder(recorder))

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Authorization", "Bearer "+runtimeKey)
	rec := httptest.NewRecorder()

	proxy.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	event := recorder.waitForEvents(t, 1)[0]
	if event.UserID != userID || event.TaskID != taskID {
		t.Fatalf("event identity = user:%s task:%s, want user:%s task:%s", event.UserID, event.TaskID, userID, taskID)
	}
	if event.ModelID != modelID || event.ModelName != "gpt-4o" || event.Provider != "OpenAI" {
		t.Fatalf("event model = id:%q name:%q provider:%q", event.ModelID, event.ModelName, event.Provider)
	}
	if event.InputTokens != 11 || event.OutputTokens != 7 || event.CachedTokens != 5 || event.TotalTokens != 18 {
		t.Fatalf("event tokens = input:%d output:%d cached:%d total:%d", event.InputTokens, event.OutputTokens, event.CachedTokens, event.TotalTokens)
	}
	if !event.Success || event.Source != "llmproxy" || event.RequestID != "chatcmpl_test" {
		t.Fatalf("event metadata = success:%v source:%q request:%q", event.Success, event.Source, event.RequestID)
	}
}

func TestProxyRejectsMissingRuntimeKey(t *testing.T) {
	client := newProxyTestDB(t)
	proxy := NewProxy(client, slog.New(slog.NewTextHandler(io.Discard, nil)))

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-4o"}`))
	rec := httptest.NewRecorder()

	proxy.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestProxyRejectsModelMismatch(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("upstream should not be called")
	}))
	t.Cleanup(upstream.Close)

	client := newProxyTestDB(t)
	runtimeKey := seedProxyModel(t, client, upstream.URL)
	proxy := NewProxy(client, slog.New(slog.NewTextHandler(io.Discard, nil)))

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"other-model"}`))
	req.Header.Set("Authorization", "Bearer "+runtimeKey)
	rec := httptest.NewRecorder()

	proxy.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

func TestProxyAppendsEndpointToVersionedBaseURL(t *testing.T) {
	var gotPath string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"resp_test"}`))
	}))
	t.Cleanup(upstream.Close)

	client := newProxyTestDB(t)
	runtimeKey := seedProxyModel(t, client, upstream.URL+"/v1")
	proxy := NewProxy(client, slog.New(slog.NewTextHandler(io.Discard, nil)))

	req := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{"model":"gpt-4o","input":"hi"}`))
	req.Header.Set("X-Api-Key", runtimeKey)
	rec := httptest.NewRecorder()

	proxy.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if gotPath != "/v1/responses" {
		t.Fatalf("upstream path = %q, want /v1/responses", gotPath)
	}
}
