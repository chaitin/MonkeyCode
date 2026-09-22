package responses

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

func TestResponsesImageTool(t *testing.T) {
	var pngBytes bytes.Buffer
	if err := png.Encode(&pngBytes, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" || r.Header.Get("Authorization") != "Bearer upstream-key" {
			t.Errorf("Responses 上游鉴权或路径错误: %s", r.URL.Path)
		}
		var request struct {
			Model string `json:"model"`
			Tools []struct {
				Type   string `json:"type"`
				Model  string `json:"model"`
				Action string `json:"action"`
				Size   string `json:"size"`
			} `json:"tools"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if request.Model != "gpt-5" || len(request.Tools) != 1 || request.Tools[0].Type != "image_generation" || request.Tools[0].Model != "gpt-image-2.5-sunburst" || request.Tools[0].Size != "2560x1440" {
			t.Errorf("Responses 工具参数错误: %+v", request)
		}
		json.NewEncoder(w).Encode(map[string]any{"id": "response-1", "output": []map[string]any{{"type": "message"},
			{"type": "image_generation_call", "status": "completed", "result": base64.StdEncoding.EncodeToString(pngBytes.Bytes())}}})
	}))
	defer server.Close()
	p := New(server.Client())
	result, err := p.Generate(context.Background(), proxy.Target{BaseURL: server.URL + "/v1", APIKey: "upstream-key", UpstreamModel: "gpt-5"},
		imagegen.ProviderRequest{Prompt: "猫", Quality: "2K", AspectRatio: "16:9", Count: 1})
	if err != nil || result.Status != "succeeded" || result.RequestID != "response-1" || len(result.Images) != 1 {
		t.Fatalf("Responses 生图工具结果错误: %+v, %v", result, err)
	}
}

func TestResponsesEditRejectsUnsupportedMask(t *testing.T) {
	p := New(&http.Client{})
	result, err := p.Edit(context.Background(), proxy.Target{}, imagegen.ProviderRequest{Mask: &imagegen.Input{}})
	if err != nil || result.Status != "failed" {
		t.Fatalf("Responses 不应假装支持蒙版: %+v, %v", result, err)
	}
}
