package images

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

func fixture(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestGenerateMapsTierAndAspect(t *testing.T) {
	content := fixture(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/generations" || r.Header.Get("Authorization") != "Bearer upstream-key" {
			t.Errorf("上游路由或鉴权错误: %s %s", r.URL.Path, r.Header.Get("Authorization"))
		}
		var input struct {
			Model string `json:"model"`
			Size  string `json:"size"`
			N     int    `json:"n"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		if input.Model != "gpt-image-2.5-flare" || input.Size != "1440x2560" || input.N != 2 {
			t.Errorf("生图参数未正确转换: %+v", input)
		}
		io.WriteString(w, `{"data":[{"b64_json":"`+base64.StdEncoding.EncodeToString(content)+`"}]}`)
	}))
	defer server.Close()
	p := New(server.Client())
	cap, err := p.Capabilities("gpt-image-2.5-flare")
	if err != nil || cap.MaxCount != 4 || len(cap.AspectRatios) != 8 {
		t.Fatalf("GPT Image 能力错误: %+v, %v", cap, err)
	}
	result, err := p.Generate(context.Background(), proxy.Target{BaseURL: server.URL + "/v1", APIKey: "upstream-key", UpstreamModel: "gpt-image-2.5-flare"},
		imagegen.ProviderRequest{Prompt: "猫", Quality: "2K", AspectRatio: "9:16", Count: 2})
	if err != nil || result.Status != "succeeded" || len(result.Images) != 1 || !bytes.Equal(result.Images[0].Data, content) {
		t.Fatalf("GPT Image 上游响应解析失败: %+v, %v", result, err)
	}
}

func TestEditUsesMultipart(t *testing.T) {
	imageBytes := fixture(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/edits" || !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data;") {
			t.Errorf("编辑接口未使用 multipart: %s %s", r.URL.Path, r.Header.Get("Content-Type"))
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Error(err)
		}
		if r.FormValue("size") != "1024x1024" || len(r.MultipartForm.File["image[]"]) != 1 || len(r.MultipartForm.File["mask"]) != 1 {
			t.Errorf("编辑表单不完整: %+v", r.MultipartForm)
		}
		io.WriteString(w, `{"data":[{"b64_json":"`+base64.StdEncoding.EncodeToString(imageBytes)+`"}]}`)
	}))
	defer server.Close()
	p := New(server.Client())
	result, err := p.Edit(context.Background(), proxy.Target{BaseURL: server.URL + "/v1", APIKey: "upstream-key", UpstreamModel: "gpt-image-1"},
		imagegen.ProviderRequest{Prompt: "换背景", Quality: "1K", AspectRatio: "1:1", Count: 1,
			Images: []imagegen.Input{{Data: imageBytes, MIMEType: "image/png"}}, Mask: &imagegen.Input{Data: imageBytes, MIMEType: "image/png"}})
	if err != nil || result.Status != "succeeded" || len(result.Images) != 1 {
		t.Fatalf("GPT Image 编辑失败: %+v, %v", result, err)
	}
}

func TestUnsupportedModelAndRejectedResponse(t *testing.T) {
	p := New(&http.Client{})
	if _, err := p.Capabilities("gpt-text"); err == nil {
		t.Fatal("不能猜测未知模型的生图能力")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadRequest) }))
	defer server.Close()
	p = New(server.Client())
	result, err := p.Generate(context.Background(), proxy.Target{BaseURL: server.URL + "/v1", UpstreamModel: "gpt-image-1"},
		imagegen.ProviderRequest{Prompt: "猫", Quality: "1K", AspectRatio: "1:1", Count: 1})
	if err != nil || result.Status != "failed" {
		t.Fatalf("明确的上游拒绝应可退款: %+v, %v", result, err)
	}
}
