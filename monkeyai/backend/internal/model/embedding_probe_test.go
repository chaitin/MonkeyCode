package model

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestProbeEmbeddingDimension(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("请求方法 = %s", r.Method)
		}
		if r.URL.Path != "/v1/embeddings" {
			t.Errorf("请求路径 = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Errorf("Authorization = %q", got)
		}
		var body struct {
			Model string `json:"model"`
			Input string `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("解析请求失败: %v", err)
		}
		if body.Model != "text-embedding-3-small" || strings.TrimSpace(body.Input) == "" {
			t.Errorf("请求体错误: %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"embedding":[0.1,0.2,0.3]}]}`)
	}))
	defer server.Close()

	dimension, err := NewService(&repositoryStub{}).probeEmbeddingDimension(t.Context(), Model{
		ModelID: "text-embedding-3-small", BaseURL: server.URL + "/v1", APIKey: "secret",
	})
	if err != nil || dimension != 3 {
		t.Fatalf("探测结果 = %d, %v", dimension, err)
	}
}

func TestTestEmbedding(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string `json:"model"`
			Input string `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("解析请求失败: %v", err)
		}
		if body.Model != "text-embedding-3-small" || body.Input != "知识库测试" {
			t.Errorf("请求体错误: %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"embedding":[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0]}],"usage":{"prompt_tokens":6,"total_tokens":6}}`)
	}))
	defer server.Close()

	for _, configuredDimension := range []int{10, 9} {
		result, err := NewService(&repositoryStub{}).testEmbedding(t.Context(), Model{
			ModelID: "text-embedding-3-small", BaseURL: server.URL + "/v1", APIKey: "secret",
			EmbeddingConfig: &EmbeddingConfig{Dimension: configuredDimension},
		}, "知识库测试")
		if err != nil {
			t.Fatal(err)
		}
		if result.Dimension != 10 || result.ConfiguredDimension != configuredDimension ||
			result.DimensionMatches != (configuredDimension == 10) {
			t.Fatalf("测试结果错误: %+v", result)
		}
		if len(result.VectorPreview) != 8 || result.VectorPreview[7] != 0.8 ||
			result.PromptTokens != 6 || result.TotalTokens != 6 {
			t.Fatalf("预览或用量错误: %+v", result)
		}
	}
}

func TestProbeEndpointSupportsEmbeddingModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Input string `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Input != "hello" {
			t.Errorf("请求体错误: %+v, %v", body, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[{"embedding":[0.1,0.2,0.3]}],"usage":{"prompt_tokens":1,"total_tokens":1}}`)
	}))
	defer server.Close()

	request := httptest.NewRequest(http.MethodPost, "/api/admin/v1/models/model-1/probe", bytes.NewBufferString(`{"message":"hello"}`))
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("modelID", "model-1")
	request = request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, routeContext))
	response := httptest.NewRecorder()
	service := NewService(&repositoryStub{models: []Model{{
		ID: "model-1", OwnershipType: "system", Kind: KindEmbedding,
		Protocol: ProtocolEmbedding, Provider: ProviderPassthrough,
		ModelID: "text-embedding-3-small", BaseURL: server.URL + "/v1", APIKey: "secret",
		EmbeddingConfig: &EmbeddingConfig{Dimension: 3}, Enabled: true,
	}}})

	service.probeModel(response, request)
	if response.Code != http.StatusOK || !strings.HasPrefix(response.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("响应错误: %d %s", response.Code, response.Body.String())
	}
	var result embeddingProbeResult
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Dimension != 3 || result.ConfiguredDimension != 3 || !result.DimensionMatches || len(result.VectorPreview) != 3 {
		t.Fatalf("测试结果错误: %+v", result)
	}
}

func TestProbeEmbeddingDimensionRejectsInvalidResponses(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		body    string
		message string
	}{
		{name: "上游错误", status: http.StatusUnauthorized, body: `{"error":"unauthorized"}`, message: "HTTP 401"},
		{name: "缺少数据", status: http.StatusOK, body: `{"data":[]}`, message: "缺少有效"},
		{name: "空向量", status: http.StatusOK, body: `{"data":[{"embedding":[]}]}`, message: "缺少有效"},
		{name: "维度不一致", status: http.StatusOK, body: `{"data":[{"embedding":[0.1,0.2]},{"embedding":[0.1]}]}`, message: "维度不一致"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer server.Close()

			_, err := NewService(&repositoryStub{}).probeEmbeddingDimension(t.Context(), Model{
				ModelID: "text-embedding-3-small", BaseURL: server.URL + "/v1", APIKey: "secret",
			})
			if err == nil || !strings.Contains(err.Error(), tc.message) {
				t.Fatalf("错误 = %v, 期望包含 %q", err, tc.message)
			}
		})
	}
}
