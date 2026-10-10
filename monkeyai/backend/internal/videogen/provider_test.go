package videogen

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestProviderQuery(t *testing.T) {
	for _, tc := range []struct {
		model, path, body string
	}{
		{"grok-imagine-video-1.5", "/v1/videos/request-123", `{"status":"done","video":{"url":"https://assets.example/video.mp4","duration":6}}`},
		{"MiniMax-H3", "/v2/query/video_generation/request-123", `{"task":{"status":"succeeded","content":{"url":"https://assets.example/video.mp4"},"duration":6}}`},
	} {
		t.Run(tc.model, func(t *testing.T) {
			client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path != tc.path {
					t.Fatalf("错误的上游查询路径: %s", r.URL.Path)
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(tc.body)), Header: http.Header{}}, nil
			})}
			result, err := queryProvider(context.Background(), client,
				proxy.Target{UpstreamModel: tc.model, BaseURL: "https://provider.example", APIKey: "secret"}, "request-123")
			if err != nil || result.Status != "succeeded" || result.DurationMs != 6000 {
				t.Fatalf("查询结果: %+v, err=%v", result, err)
			}
		})
	}
}

func TestProviderSubmission(t *testing.T) {
	for _, tc := range []struct {
		name, path string
		response   string
	}{
		{"grok-imagine-video-1.5", "/v1/videos/generations", `{"request_id":"request-123"}`},
		{"MiniMax-H3", "/v2/video_generation", `{"task_id":"task-123"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path != tc.path || r.Header.Get("Authorization") != "Bearer secret" {
					t.Fatalf("错误的上游路径或鉴权: %s", r.URL)
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if body["resolution"] != "720p" {
					t.Fatalf("错误的清晰度: %v", body)
				}
				if tc.name == "MiniMax-H3" {
					items, ok := body["content"].([]any)
					if !ok || len(items) != 2 || items[1].(map[string]any)["role"] != "first_frame" {
						t.Fatalf("MiniMax 参考图角色无效: %v", body)
					}
				} else if _, ok := body["aspect_ratio"]; ok {
					t.Fatal("Grok 首帧模式不应发送被忽略的比例")
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(tc.response)), Header: http.Header{}}, nil
			})}
			input := GenerateInput{Mode: model.VideoImageToVideo, Prompt: "海边",
				Params:     map[string]json.RawMessage{"resolution": json.RawMessage(`"720p"`), "duration_seconds": json.RawMessage(`6`), "aspect_ratio": json.RawMessage(`"adaptive"`)},
				References: []Reference{{Role: "first_frame", MIMEType: "image/png", Data: []byte("image")}}}
			id, err := submitProvider(context.Background(), client,
				proxy.Target{UpstreamModel: tc.name, BaseURL: "https://provider.example", APIKey: "secret"}, input)
			if err != nil || id == "" {
				t.Fatalf("受理失败: id=%s err=%v", id, err)
			}
		})
	}
}
