package volcengine

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

func TestSeedreamReferenceEdit(t *testing.T) {
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v3/images/generations" || r.Header.Get("Authorization") != "Bearer upstream-key" {
			t.Errorf("Seedream 上游路由或密钥错误: %s", r.URL.Path)
		}
		var request struct {
			Model  string   `json:"model"`
			Size   string   `json:"size"`
			Images []string `json:"image"`
			Format string   `json:"response_format"`
			Output string   `json:"output_format"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if request.Model != "doubao-seedream-5-0-pro-260628" || request.Size != "1440x2560" || request.Format != "b64_json" || request.Output != "png" || len(request.Images) != 1 || !strings.HasPrefix(request.Images[0], "data:image/png;base64,") {
			t.Errorf("Seedream 图生图参数错误: %+v", request)
		}
		json.NewEncoder(w).Encode(map[string]any{"data": []map[string]string{{"b64_json": base64.StdEncoding.EncodeToString(imageBytes.Bytes())}}})
	}))
	defer server.Close()
	p := New(server.Client())
	cap, err := p.Capabilities("doubao-seedream-5-0-pro-260628")
	if err != nil || cap.MaxCount != 1 || !cap.SupportsReference {
		t.Fatalf("Seedream 5.0 pro 能力错误: %+v, %v", cap, err)
	}
	result, err := p.Edit(context.Background(), proxy.Target{BaseURL: server.URL + "/api/v3", UpstreamModel: "doubao-seedream-5-0-pro-260628", APIKey: "upstream-key"},
		imagegen.ProviderRequest{Prompt: "改成日落", Quality: "2K", AspectRatio: "9:16", Count: 1,
			Images: []imagegen.Input{{Data: imageBytes.Bytes(), MIMEType: "image/png"}}})
	if err != nil || result.Status != "succeeded" || len(result.Images) != 1 {
		t.Fatalf("Seedream 结果解析失败: %+v, %v", result, err)
	}
	if _, err := p.Capabilities("doubao-seedream-unknown"); err == nil {
		t.Fatal("未知模型不应被当成 Seedream 5.0 pro")
	}
}
