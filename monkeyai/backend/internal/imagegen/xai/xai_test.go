package xai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

func TestGrokImageGeneration(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/generations" || r.Header.Get("Authorization") != "Bearer upstream-key" {
			t.Errorf("Grok 路由或鉴权错误: %s", r.URL.Path)
		}
		var body struct {
			Resolution  string `json:"resolution"`
			AspectRatio string `json:"aspect_ratio"`
			Format      string `json:"response_format"`
			N           int    `json:"n"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Resolution != "4k" || body.AspectRatio != "9:16" || body.Format != "b64_json" || body.N != 2 {
			t.Errorf("Grok 参数未映射: %+v", body)
		}
		json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"b64_json": base64.StdEncoding.EncodeToString([]byte("image-bytes"))}}})
	}))
	defer server.Close()
	p := New(server.Client())
	cap, err := p.Capabilities("grok-imagine-image-2.0")
	if err != nil || len(cap.Operations) != 1 || len(cap.Qualities) != 3 || cap.Qualities[2] != "4K" || cap.MaxCount != 4 {
		t.Fatalf("Grok 能力错误: %+v, %v", cap, err)
	}
	if defaults := p.DefaultCapabilities(); len(defaults.Qualities) != 3 || len(defaults.AspectRatios) != 8 {
		t.Fatalf("Grok 默认能力错误: %+v", defaults)
	}
	result, err := p.Generate(context.Background(), proxy.Target{BaseURL: server.URL + "/v1", APIKey: "upstream-key", UpstreamModel: "grok-imagine-image-2.0"},
		imagegen.ProviderRequest{Prompt: "test", Quality: "4K", AspectRatio: "9:16", Count: 2})
	if err != nil || result.Status != "succeeded" || len(result.Images) != 1 {
		t.Fatalf("Grok 解析错误: %+v, %v", result, err)
	}
	if custom, err := p.Capabilities("custom-grok-alias"); err != nil || len(custom.Qualities) != 3 {
		t.Fatalf("自定义模型应使用 Grok 默认能力: %+v, %v", custom, err)
	}
}
