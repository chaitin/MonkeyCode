package xai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
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
	if err != nil || len(cap.Operations) != 2 || len(cap.Qualities) != 3 || cap.Qualities[2] != "4K" || cap.MaxCount != 4 || cap.MaxReferences != 5 || !cap.SupportsReference {
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

func TestGrokImageEditing(t *testing.T) {
	type reference struct {
		Type string `json:"type"`
		URL  string `json:"url"`
	}
	type request struct {
		Prompt      string      `json:"prompt"`
		Image       *reference  `json:"image"`
		Images      []reference `json:"images"`
		Resolution  string      `json:"resolution"`
		AspectRatio string      `json:"aspect_ratio"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/edits" || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("Grok 编辑路由或内容类型错误: %s %s", r.URL.Path, r.Header.Get("Content-Type"))
		}
		var body request
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Resolution != "2k" || body.AspectRatio != "16:9" {
			t.Errorf("Grok 编辑参数未映射: %+v", body)
		}
		switch body.Prompt {
		case "single":
			if body.Image == nil || len(body.Images) != 0 || body.Image.Type != "image_url" || !strings.HasPrefix(body.Image.URL, "data:image/png;base64,") {
				t.Errorf("Grok 单图编辑参数错误: %+v", body)
			}
		case "multi":
			if body.Image != nil || len(body.Images) != 2 || !strings.HasPrefix(body.Images[0].URL, "data:image/png;base64,") || !strings.HasPrefix(body.Images[1].URL, "data:image/jpeg;base64,") {
				t.Errorf("Grok 多图编辑参数错误: %+v", body)
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"b64_json": base64.StdEncoding.EncodeToString([]byte("edited-image"))}}})
	}))
	defer server.Close()

	p := New(server.Client())
	target := proxy.Target{BaseURL: server.URL + "/v1", APIKey: "upstream-key", UpstreamModel: "grok-imagine-image-2.0"}
	for _, test := range []struct {
		prompt string
		images []imagegen.Input
	}{
		{prompt: "single", images: []imagegen.Input{{Data: []byte("one"), MIMEType: "image/png"}}},
		{prompt: "multi", images: []imagegen.Input{{Data: []byte("one"), MIMEType: "image/png"}, {Data: []byte("two"), MIMEType: "image/jpeg"}}},
	} {
		result, err := p.Edit(context.Background(), target, imagegen.ProviderRequest{
			Prompt: test.prompt, Quality: "2K", AspectRatio: "16:9", Count: 1, Images: test.images,
		})
		if err != nil || result.Status != "succeeded" || len(result.Images) != 1 {
			t.Fatalf("Grok 编辑失败: %+v, %v", result, err)
		}
	}

	tooMany := make([]imagegen.Input, 6)
	result, err := p.Edit(context.Background(), target, imagegen.ProviderRequest{
		Quality: "2K", AspectRatio: "16:9", Count: 1, Images: tooMany,
	})
	if err != nil || result.Status != "failed" || result.ErrorCode != "invalid_reference_image" {
		t.Fatalf("Grok 应拒绝超过五张参考图: %+v, %v", result, err)
	}
}
