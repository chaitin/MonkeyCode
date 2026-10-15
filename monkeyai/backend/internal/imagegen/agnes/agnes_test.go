package agnes

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

func TestAgnesImageGenerationAndEdit(t *testing.T) {
	expected := []byte("generated-image")
	encoded := base64.StdEncoding.EncodeToString(expected)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/generations" || r.Header.Get("Authorization") != "Bearer agnes-key" {
			t.Fatalf("Agnes 图片请求地址或鉴权错误: %s", r.URL)
		}
		var request struct {
			Model        string `json:"model"`
			Size         string `json:"size"`
			Ratio        string `json:"ratio"`
			ReturnBase64 bool   `json:"return_base64"`
			ExtraBody    struct {
				Format string   `json:"response_format"`
				Images []string `json:"image"`
			} `json:"extra_body"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.Model != modelID || request.Size != "2K" || request.Ratio != "16:9" || request.ExtraBody.Format != "b64_json" || len(request.ExtraBody.Images) != 1 || request.ReturnBase64 {
			t.Fatalf("Agnes 图片参数错误: %+v", request)
		}
		_, _ = io.WriteString(w, `{"created":1,"data":[{"b64_json":"`+encoded+`"}]}`)
	}))
	defer server.Close()
	provider := New(server.Client())
	cap, err := provider.Capabilities(modelID)
	if err != nil || len(cap.Qualities) != 3 || cap.MaxReferences != 8 || !cap.SupportsReference {
		t.Fatalf("Agnes 图片能力错误: %+v, %v", cap, err)
	}
	result, err := provider.Edit(context.Background(), proxy.Target{BaseURL: server.URL + "/v1", UpstreamModel: modelID, APIKey: "agnes-key"}, imagegen.ProviderRequest{
		Prompt: "编辑", Quality: "2K", AspectRatio: "16:9", Count: 1,
		Images: []imagegen.Input{{Data: []byte("reference"), MIMEType: "image/png"}},
	})
	if err != nil || result.Status != "succeeded" || len(result.Images) != 1 || string(result.Images[0].Data) != string(expected) {
		t.Fatalf("Agnes 图片结果错误: %+v, %v", result, err)
	}
	if _, err := provider.Capabilities("other-model"); err == nil {
		t.Fatal("不应接受未知 Agnes 图片型号")
	}
}

func TestAgnesImageDefaultCapabilities(t *testing.T) {
	cap := New(nil).DefaultCapabilities()
	if len(cap.Operations) != 2 || cap.AspectRatios[len(cap.AspectRatios)-1] != "21:9" {
		t.Fatalf("默认能力错误: %+v", cap)
	}
}
