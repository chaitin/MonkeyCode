package kbqa

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAsk_Success_StripsCitation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/share/v1/chat/completions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("unexpected auth header: %s", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"MonkeyCode 是开源 AI 开发平台[[1](https://x.com/a)]。"}}]}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "test-key", "deepseek-v3.2")
	got, err := c.Ask(context.Background(), "什么是 MonkeyCode")
	if err != nil {
		t.Fatalf("Ask: %v", err)
	}
	want := "MonkeyCode 是开源 AI 开发平台。"
	if got != want {
		t.Errorf("got %q, want %q (citation should be stripped)", got, want)
	}
}

func TestAsk_NonOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "bad", "")
	_, err := c.Ask(context.Background(), "q")
	if err == nil {
		t.Fatal("expected error on non-200")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("error should mention status code: %v", err)
	}
}

func TestAsk_EmptyChoices(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[]}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "k", "")
	if _, err := c.Ask(context.Background(), "q"); err == nil {
		t.Fatal("expected error on empty choices")
	}
}

func TestNewClient_DefaultModel(t *testing.T) {
	if c := NewClient("https://x", "k", ""); c.model != defaultModel {
		t.Errorf("model = %q, want default %q", c.model, defaultModel)
	}
	if c := NewClient("https://x", "k", "custom"); c.model != "custom" {
		t.Errorf("model = %q, want custom", c.model)
	}
}

func TestCleanForWeChat(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"citation stripped", "答案[[1](https://x/n/abc)]。", "答案。"},
		{"image to bare url", "见下图：![架构图](https://img.cdn/a.png)", "见下图：\nhttps://img.cdn/a.png"},
		{"link to text-colon-url", "详见[文档](https://docs/x)", "详见文档：https://docs/x"},
		{"bold removed", "这是**重点**内容", "这是重点内容"},
		{"italic removed", "这是*斜体*内容", "这是斜体内容"},
		{"heading removed", "## 功能列表\n内容", "功能列表\n内容"},
		{"inline code unwrapped", "执行 `go build` 命令", "执行 go build 命令"},
		{"code fence stripped", "示例：\n```go\nfmt.Println(1)\n```\n完毕", "示例：\nfmt.Println(1)\n完毕"},
		{"plain unchanged", "普通文本 https://a.com 直接可点", "普通文本 https://a.com 直接可点"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := cleanForWeChat(c.in); got != c.want {
				t.Errorf("cleanForWeChat(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}
