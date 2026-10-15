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

func TestAgnesVideoSubmissionAndQuery(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method == http.MethodPost {
			if r.URL.Path != "/v1/videos" || r.Header.Get("Authorization") != "Bearer agnes-key" {
				t.Fatalf("Agnes 创建请求错误: %s", r.URL)
			}
			var request struct {
				Model      string `json:"model"`
				Prompt     string `json:"prompt"`
				Seconds    string `json:"seconds"`
				Mode       string `json:"mode"`
				Size       string `json:"size"`
				Ratio      string `json:"aspect_ratio"`
				FirstFrame string `json:"first_frame"`
				LastFrame  string `json:"last_frame"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Fatal(err)
			}
			if request.Model != "agnes-video-2.5" || request.Prompt != "平滑转场" || request.Seconds != "8" || request.Mode != "keyframe" || request.Size != "1080P" || request.Ratio != "16:9" || !strings.HasPrefix(request.FirstFrame, "data:image/png;base64,") || request.LastFrame == "" {
				t.Fatalf("Agnes 创建参数错误: %+v", request)
			}
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"id":"task-1","task_id":"task-1","video_id":"video-1","status":"queued"}`))}, nil
		}
		if r.Method == http.MethodGet {
			if r.URL.Path != "/agnesapi" || r.URL.Query().Get("video_id") != "video-1" || r.URL.Query().Get("model_name") != "agnes-video-2.5" {
				t.Fatalf("Agnes 查询请求错误: %s", r.URL.String())
			}
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"status":"completed","seconds":"8.5","url":"https://assets.example/video.mp4"}`))}, nil
		}
		return nil, nil
	})}
	target := proxy.Target{BaseURL: "https://apihub.agnes-ai.com/v1", UpstreamModel: "agnes-video-2.5", APIKey: "agnes-key"}
	input := GenerateInput{Mode: model.VideoFirstLastToVideo, Prompt: "平滑转场", Params: map[string]json.RawMessage{
		"resolution": json.RawMessage(`"1080P"`), "aspect_ratio": json.RawMessage(`"16:9"`), "duration_seconds": json.RawMessage(`8`),
	}, References: []Reference{{Role: "first_frame", MIMEType: "image/png", Data: []byte("first")}, {Role: "last_frame", MIMEType: "image/png", Data: []byte("last")}}}
	id, err := submitProvider(context.Background(), client, target, input)
	if err != nil || id != "video-1" {
		t.Fatalf("Agnes 创建结果错误: %s, %v", id, err)
	}
	result, err := queryProvider(context.Background(), client, target, id)
	if err != nil || result.Status != "succeeded" || result.URL != "https://assets.example/video.mp4" || result.DurationMs != 8500 {
		t.Fatalf("Agnes 查询结果错误: %+v, %v", result, err)
	}
}

func TestAgnesVideoReferenceSubmission(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		var request struct {
			Mode   string   `json:"mode"`
			Images []string `json:"images"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.Mode != "reference" || len(request.Images) != 2 || !strings.HasPrefix(request.Images[0], "data:image/jpeg;base64,") {
			t.Fatalf("Agnes 参考图参数错误: %+v", request)
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"video_id":"video-reference"}`))}, nil
	})}
	input := GenerateInput{Mode: model.VideoReferenceImageToVideo, Prompt: "参考图片生成视频", Params: map[string]json.RawMessage{
		"resolution": json.RawMessage(`"720P"`), "aspect_ratio": json.RawMessage(`"1:1"`), "duration_seconds": json.RawMessage(`4`),
	}, References: []Reference{{Role: "reference_image", MIMEType: "image/jpeg", Data: []byte("a")}, {Role: "reference_image", MIMEType: "image/jpeg", Data: []byte("b")}}}
	id, err := submitProvider(context.Background(), client, proxy.Target{BaseURL: "https://apihub.agnes-ai.com/v1", UpstreamModel: "agnes-video-2.5", APIKey: "key"}, input)
	if err != nil || id != "video-reference" {
		t.Fatalf("Agnes 参考图创建结果错误: %s, %v", id, err)
	}
}
