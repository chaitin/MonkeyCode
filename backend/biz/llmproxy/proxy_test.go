package llmproxy

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
)

func newProxyTestDB(t *testing.T) *db.Client {
	t.Helper()
	client := enttest.Open(t, "sqlite3", "file:llmproxy-test?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func seedProxyModel(t *testing.T, client *db.Client, upstreamURL string) string {
	t.Helper()
	ctx := context.Background()
	userID := uuid.New()
	modelID := uuid.New()
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
	if _, err := client.ModelApiKey.Create().
		SetID(uuid.New()).
		SetUserID(userID).
		SetModelID(modelID).
		SetAPIKey(key).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	return key
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
