package llm

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestChatAnthropicUsesSDKClient(t *testing.T) {
	var called atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called.Store(true)
		assertAnthropicSDKRequest(t, r)

		var body struct {
			Model       string   `json:"model"`
			MaxTokens   int64    `json:"max_tokens"`
			Temperature *float64 `json:"temperature"`
			System      []struct {
				Text string `json:"text"`
			} `json:"system"`
			Messages []struct {
				Role    string `json:"role"`
				Content []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if body.Model != "claude-3-5-haiku-latest" {
			t.Fatalf("model = %q", body.Model)
		}
		if body.MaxTokens != 12 {
			t.Fatalf("max_tokens = %d", body.MaxTokens)
		}
		if body.Temperature == nil || math.Abs(*body.Temperature-0.4) > 0.000001 {
			t.Fatalf("temperature = %v", body.Temperature)
		}
		if len(body.System) != 1 || body.System[0].Text != "system prompt" {
			t.Fatalf("system = %+v", body.System)
		}
		if len(body.Messages) != 2 {
			t.Fatalf("messages length = %d", len(body.Messages))
		}
		if body.Messages[0].Role != "user" || body.Messages[0].Content[0].Text != "hello" {
			t.Fatalf("first message = %+v", body.Messages[0])
		}
		if body.Messages[1].Role != "assistant" || body.Messages[1].Content[0].Text != "hi" {
			t.Fatalf("second message = %+v", body.Messages[1])
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"msg_1",
			"type":"message",
			"role":"assistant",
			"content":[
				{"type":"text","text":"hello "},
				{"type":"text","text":"world"}
			],
			"usage":{"input_tokens":7,"output_tokens":5}
		}`))
	}))
	defer server.Close()

	client := NewClient(Config{
		BaseURL:       server.URL + "/v1",
		APIKey:        "test-key",
		Model:         "claude-3-5-haiku-latest",
		InterfaceType: InterfaceAnthropic,
	})

	resp, err := client.Chat(context.Background(), ChatRequest{
		Messages: []Message{
			{Role: "system", Content: "system prompt"},
			{Role: "user", Content: "hello"},
			{Role: "assistant", Content: "hi"},
		},
		MaxTokens:   12,
		Temperature: 0.4,
	})
	if err != nil {
		t.Fatalf("Chat returned error: %v", err)
	}
	if !called.Load() {
		t.Fatal("server was not called")
	}
	if resp.Content != "hello world" {
		t.Fatalf("content = %q", resp.Content)
	}
	if resp.Usage.PromptTokens != 7 || resp.Usage.CompletionTokens != 5 || resp.Usage.TotalTokens != 12 {
		t.Fatalf("usage = %+v", resp.Usage)
	}
}

func TestHealthCheckAnthropicUsesSDKClient(t *testing.T) {
	var called atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called.Store(true)
		assertAnthropicSDKRequest(t, r)

		var body struct {
			Model     string `json:"model"`
			MaxTokens int64  `json:"max_tokens"`
			Messages  []struct {
				Role    string `json:"role"`
				Content []struct {
					Text string `json:"text"`
				} `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if body.Model != "claude-3-5-haiku-latest" {
			t.Fatalf("model = %q", body.Model)
		}
		if body.MaxTokens != 1 {
			t.Fatalf("max_tokens = %d", body.MaxTokens)
		}
		if len(body.Messages) != 1 || body.Messages[0].Role != "user" || body.Messages[0].Content[0].Text != "hi" {
			t.Fatalf("messages = %+v", body.Messages)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"msg_health",
			"type":"message",
			"role":"assistant",
			"content":[{"type":"text","text":"ok"}],
			"usage":{"input_tokens":1,"output_tokens":1}
		}`))
	}))
	defer server.Close()

	err := HealthCheck(context.Background(), Config{
		BaseURL:       server.URL + "/v1",
		APIKey:        "test-key",
		Model:         "claude-3-5-haiku-latest",
		InterfaceType: InterfaceAnthropic,
	})
	if err != nil {
		t.Fatalf("HealthCheck returned error: %v", err)
	}
	if !called.Load() {
		t.Fatal("server was not called")
	}
}

func TestNormalizeAnthropicBaseURL(t *testing.T) {
	tests := map[string]string{
		"https://api.anthropic.com":     "https://api.anthropic.com",
		"https://api.anthropic.com/":    "https://api.anthropic.com",
		"https://api.anthropic.com/v1":  "https://api.anthropic.com",
		"https://api.anthropic.com/v1/": "https://api.anthropic.com",
	}

	for input, want := range tests {
		if got := normalizeAnthropicBaseURL(input); got != want {
			t.Fatalf("normalizeAnthropicBaseURL(%q) = %q, want %q", input, got, want)
		}
	}
}

func assertAnthropicSDKRequest(t *testing.T, r *http.Request) {
	t.Helper()
	if r.Method != http.MethodPost {
		t.Fatalf("method = %s", r.Method)
	}
	if r.URL.Path != "/v1/messages" {
		t.Fatalf("path = %s", r.URL.Path)
	}
	if r.Header.Get("x-api-key") != "test-key" {
		t.Fatalf("x-api-key = %q", r.Header.Get("x-api-key"))
	}
	if r.Header.Get("anthropic-version") != "2023-06-01" {
		t.Fatalf("anthropic-version = %q", r.Header.Get("anthropic-version"))
	}
	if r.Header.Get("X-Stainless-Retry-Count") == "" {
		t.Fatal("missing SDK header X-Stainless-Retry-Count")
	}
	if !strings.Contains(r.Header.Get("User-Agent"), "Anthropic/Go") {
		t.Fatalf("user-agent = %q", r.Header.Get("User-Agent"))
	}
}
