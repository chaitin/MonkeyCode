package llmproxy

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
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
	events []modelusage.Event
}

func (s *usageRecorderStub) Record(ctx context.Context, event modelusage.Event) error {
	s.events = append(s.events, event)
	return nil
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
	if len(recorder.events) != 1 {
		t.Fatalf("usage events = %d, want 1", len(recorder.events))
	}
	event := recorder.events[0]
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

func TestParseOpenAIResponsesUsage(t *testing.T) {
	usage, ok := parseUsage("/responses", []byte(`{
		"type":"response.completed",
		"response":{
			"id":"resp_test",
			"usage":{
				"input_tokens":100,
				"output_tokens":20,
				"total_tokens":120,
				"input_tokens_details":{"cached_tokens":30}
			}
		}
	}`))

	if !ok {
		t.Fatal("usage not parsed")
	}
	if usage.requestID != "resp_test" || usage.inputTokens != 100 || usage.outputTokens != 20 || usage.cachedTokens != 30 || usage.totalTokens != 120 {
		t.Fatalf("usage = %+v", usage)
	}
}

func TestParseOpenAIResponsesStreamUsage(t *testing.T) {
	usage, ok := parseUsage("/responses", []byte(strings.Join([]string{
		"event: response.output_text.delta",
		`data: {"delta":"hello"}`,
		"",
		"event: response.completed",
		`data: {"type":"response.completed","response":{"id":"resp_stream","usage":{"input_tokens":8,"output_tokens":3,"total_tokens":11}}}`,
		"",
	}, "\n")))

	if !ok {
		t.Fatal("usage not parsed")
	}
	if usage.requestID != "resp_stream" || usage.inputTokens != 8 || usage.outputTokens != 3 || usage.totalTokens != 11 {
		t.Fatalf("usage = %+v", usage)
	}
}

func TestParseOpenAIChatCompletionStreamUsage(t *testing.T) {
	usage, ok := parseUsage("/chat/completions", []byte(strings.Join([]string{
		`data: {"choices":[{"delta":{"content":"hi"}}]}`,
		"",
		`data: {"id":"chat_stream","usage":{"prompt_tokens":4,"completion_tokens":6,"total_tokens":10,"prompt_tokens_details":{"cached_tokens":2}}}`,
		"",
		"data: [DONE]",
		"",
	}, "\n")))

	if !ok {
		t.Fatal("usage not parsed")
	}
	if usage.requestID != "chat_stream" || usage.inputTokens != 4 || usage.outputTokens != 6 || usage.cachedTokens != 2 || usage.totalTokens != 10 {
		t.Fatalf("usage = %+v", usage)
	}
}

func TestParseAnthropicUsageIncludesCacheReadTokensInInput(t *testing.T) {
	usage, ok := parseUsage("/messages", []byte(`{
		"id":"msg_test",
		"usage":{
			"input_tokens":7,
			"output_tokens":5,
			"cache_read_input_tokens":3,
			"cache_creation_input_tokens":2
		}
	}`))

	if !ok {
		t.Fatal("usage not parsed")
	}
	if usage.requestID != "msg_test" || usage.inputTokens != 10 || usage.outputTokens != 5 || usage.cachedTokens != 3 || usage.totalTokens != 15 {
		t.Fatalf("usage = %+v", usage)
	}
}

func TestParseAnthropicStreamUsage(t *testing.T) {
	usage, ok := parseUsage("/messages", []byte(strings.Join([]string{
		"event: message_start",
		`data: {"type":"message_start","message":{"id":"msg_stream","usage":{"input_tokens":7,"cache_read_input_tokens":3,"cache_creation_input_tokens":2}}}`,
		"",
		"event: message_delta",
		`data: {"type":"message_delta","usage":{"output_tokens":5}}`,
		"",
	}, "\n")))

	if !ok {
		t.Fatal("usage not parsed")
	}
	if usage.requestID != "msg_stream" || usage.inputTokens != 10 || usage.outputTokens != 5 || usage.cachedTokens != 3 || usage.totalTokens != 15 {
		t.Fatalf("usage = %+v", usage)
	}
}

func TestUsageCaptureBodyRecordsAfterReadEOF(t *testing.T) {
	var got string
	body := newUsageCaptureBody(io.NopCloser(strings.NewReader("hello")), func(body []byte) {
		got = string(body)
	})

	if got != "" {
		t.Fatalf("got callback before read: %q", got)
	}
	data, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello" {
		t.Fatalf("body = %q", data)
	}
	if got != "hello" {
		t.Fatalf("captured = %q", got)
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
