package model

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestAgentModelsEndpoint(t *testing.T) {
	repo := &repositoryStub{models: []Model{{
		ID: "model-1", ModelID: "upstream-name", DisplayName: "模型", Protocol: ProtocolOpenAIResponses,
		BaseURL: "https://upstream.example.com/v1", APIKey: "upstream-secret",
	}}}
	router := chi.NewRouter()
	NewService(repo).WithGatewayURL("https://monkeyai.example.com/v1/").RegisterAgent(router)
	read := func(match string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/models", nil)
		r.Header.Set("If-None-Match", match)
		router.ServeHTTP(w, r)
		return w
	}
	first := read("")
	var body struct {
		Models  []AgentModel `json:"models"`
		Gateway struct {
			BaseURL        string `json:"base_url"`
			Authentication string `json:"authentication"`
		} `json:"model_gateway"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if first.Code != http.StatusOK || len(body.Models) != 1 || body.Models[0].ID != "model-1" || body.Models[0].Model != "upstream-name" || body.Gateway.BaseURL != "https://monkeyai.example.com/v1" || body.Gateway.Authentication != "api_key" {
		t.Fatalf("模型目录无效: %d %s", first.Code, first.Body.String())
	}
	for _, key := range []string{"upstream-secret", "https://upstream.example.com/v1", `"settings"`, `"rules"`, `"skills"`, `"experts"`, `"connectors"`} {
		if strings.Contains(first.Body.String(), key) {
			t.Fatalf("模型目录包含无关数据: %s", first.Body.String())
		}
	}
	etag := first.Header().Get("ETag")
	if etag == "" || read(etag).Code != http.StatusNotModified {
		t.Fatal("模型目录未命中缓存")
	}
	repo.models = nil
	removed := read(etag)
	if removed.Code != http.StatusOK || removed.Header().Get("ETag") == etag || !strings.Contains(removed.Body.String(), `"models":[]`) {
		t.Fatalf("模型删除后目录未更新: %d %s", removed.Code, removed.Body.String())
	}
}
