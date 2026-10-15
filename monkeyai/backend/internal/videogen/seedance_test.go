package videogen

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

func seedanceInput() GenerateInput {
	return GenerateInput{Mode: model.VideoTextToVideo, Prompt: "海边日落",
		Params: map[string]json.RawMessage{
			"resolution": json.RawMessage(`"720p"`), "aspect_ratio": json.RawMessage(`"adaptive"`),
			"duration_seconds": json.RawMessage(`6`), "generate_audio": json.RawMessage(`false`),
		},
	}
}

func TestSeedanceSubmission(t *testing.T) {
	for _, modelID := range []string{"doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628"} {
		for _, mode := range []model.VideoMode{model.VideoTextToVideo, model.VideoImageToVideo, model.VideoFirstLastToVideo, model.VideoReferenceImageToVideo} {
			t.Run(modelID+"/"+string(mode), func(t *testing.T) {
				input := seedanceInput()
				input.Mode = mode
				if modelID == "doubao-seedance-2-5-260628" {
					input.Params["duration_seconds"] = json.RawMessage(`30`)
				}
				roles := []string{}
				switch mode {
				case model.VideoImageToVideo:
					roles = []string{"first_frame"}
				case model.VideoFirstLastToVideo:
					roles = []string{"first_frame", "last_frame"}
				case model.VideoReferenceImageToVideo:
					roles = []string{"reference_image", "reference_image"}
				}
				if len(roles) > 0 {
					input.Prompt = ""
				}
				for _, role := range roles {
					input.References = append(input.References, Reference{Role: role, MIMEType: "image/png", Data: []byte("image")})
				}
				cap, err := model.VideoCapabilitiesFor(model.ProviderVolcengine, modelID)
				if err != nil {
					t.Fatal(err)
				}
				if err := validateReferences(mode, input.References, cap); err != nil {
					t.Fatal(err)
				}
				client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
					if r.Method != http.MethodPost || r.URL.Path != "/api/v3/contents/generations/tasks" || r.Header.Get("Authorization") != "Bearer secret" || r.Header.Get("Content-Type") != "application/json" {
						t.Fatalf("错误的方舟请求: %s", r.URL)
					}
					var body struct {
						Model      string `json:"model"`
						Duration   int64  `json:"duration"`
						Resolution string `json:"resolution"`
						Ratio      string `json:"ratio"`
						Audio      *bool  `json:"generate_audio"`
						Format     string `json:"output_format"`
						TaskType   string `json:"omni_reference_task_type"`
						Content    []struct {
							Type  string `json:"type"`
							Text  string `json:"text"`
							Role  string `json:"role"`
							Image struct {
								URL string `json:"url"`
							} `json:"image_url"`
						} `json:"content"`
					}
					decoder := json.NewDecoder(r.Body)
					decoder.DisallowUnknownFields()
					if err := decoder.Decode(&body); err != nil {
						t.Fatal(err)
					}
					seconds, _ := model.VideoDuration(input.Params)
					if body.Model != modelID || body.Duration != seconds || body.Resolution != "720p" || body.Ratio != "adaptive" || body.Audio == nil || *body.Audio || body.Format != "mp4" {
						t.Fatalf("方舟参数映射错误: %+v", body)
					}
					if (body.TaskType == "reference") != (modelID == "doubao-seedance-2-5-260628" && mode == model.VideoReferenceImageToVideo) {
						t.Fatalf("任务类型错误: %s", body.TaskType)
					}
					gotRoles := []string{}
					texts := 0
					for _, content := range body.Content {
						if content.Type == "text" {
							texts++
							if content.Text == "" || content.Text != input.Prompt {
								t.Fatalf("提示词映射错误: %s", content.Text)
							}
						} else {
							if content.Type != "image_url" || content.Image.URL != "data:image/png;base64,aW1hZ2U=" {
								t.Fatalf("参考图映射错误: %+v", content)
							}
							gotRoles = append(gotRoles, content.Role)
						}
					}
					if !slices.Equal(gotRoles, roles) || (texts == 1) != (input.Prompt != "") {
						t.Fatalf("提示词或参考图角色错误: %+v", body.Content)
					}
					return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"id":"cgt-123"}`))}, nil
				})}
				id, err := submitProvider(t.Context(), client, proxy.Target{UpstreamModel: modelID, BaseURL: "https://ark.example/api/v3/", APIKey: "secret"}, input)
				if err != nil || id != "cgt-123" {
					t.Fatalf("受理结果: %s, %v", id, err)
				}
			})
		}
	}
}

func TestSeedanceQuery(t *testing.T) {
	for _, tc := range []struct {
		name, modelID, body, status string
		ms                          int64
	}{
		{"2.0成功", "doubao-seedance-2-0-260128", `{"status":"succeeded","content":{"video_url":"https://assets.example/video.mp4"},"duration":15}`, "succeeded", 15000},
		{"2.5成功", "doubao-seedance-2-5-260628", `{"status":"succeeded","content":{"video_url":"https://assets.example/video.mp4"},"duration":30}`, "succeeded", 30000},
		{"毫秒精度", "doubao-seedance-2-5-260628", `{"status":"succeeded","content":{"video_url":"https://assets.example/video.mp4"},"duration":25.125}`, "succeeded", 25125},
		{"排队", "doubao-seedance-2-5-260628", `{"status":"queued"}`, "running", 0},
		{"运行", "doubao-seedance-2-5-260628", `{"status":"running"}`, "running", 0},
		{"失败", "doubao-seedance-2-5-260628", `{"status":"failed","error":{"code":"InvalidParameter"}}`, "failed", 0},
		{"过期", "doubao-seedance-2-5-260628", `{"status":"expired"}`, "failed", 0},
		{"取消", "doubao-seedance-2-5-260628", `{"status":"cancelled"}`, "failed", 0},
		{"2.0超时长", "doubao-seedance-2-0-260128", `{"status":"succeeded","content":{"video_url":"https://assets.example/video.mp4"},"duration":16}`, "", 0},
		{"2.5超时长", "doubao-seedance-2-5-260628", `{"status":"succeeded","content":{"video_url":"https://assets.example/video.mp4"},"duration":31}`, "", 0},
		{"缺少地址", "doubao-seedance-2-5-260628", `{"status":"succeeded","duration":30}`, "", 0},
		{"缺少时长", "doubao-seedance-2-5-260628", `{"status":"succeeded","content":{"video_url":"https://assets.example/video.mp4"}}`, "", 0},
		{"未知状态", "doubao-seedance-2-5-260628", `{"status":"unknown"}`, "", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.Method != http.MethodGet || r.URL.Path != "/api/v3/contents/generations/tasks/cgt-123" || r.Header.Get("Authorization") != "Bearer secret" {
					t.Fatalf("查询请求错误: %s", r.URL)
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})}
			result, err := queryProvider(t.Context(), client, proxy.Target{UpstreamModel: tc.modelID, BaseURL: "https://ark.example/api/v3", APIKey: "secret"}, "cgt-123")
			if tc.status == "" {
				if err == nil {
					t.Fatalf("不应接受无效上游结果: %+v", result)
				}
				return
			}
			if err != nil || result.Status != tc.status || result.DurationMs != tc.ms || result.JobID != "cgt-123" {
				t.Fatalf("查询结果: %+v, %v", result, err)
			}
		})
	}
}

func TestSeedanceSubmissionFailure(t *testing.T) {
	for _, tc := range []struct {
		status   int
		body     string
		rejected bool
	}{
		{400, `{"error":{"code":"InvalidParameter"}}`, true},
		{429, `{}`, false},
		{500, `{}`, false},
		{200, `{"id":"../invalid"}`, false},
		{200, `{"request_id":"wrong-field"}`, false},
	} {
		client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
		})}
		_, err := submitProvider(t.Context(), client, proxy.Target{UpstreamModel: "doubao-seedance-2-5-260628", BaseURL: "https://ark.example/api/v3"}, seedanceInput())
		var rejected providerRejected
		if err == nil || errors.As(err, &rejected) != tc.rejected {
			t.Fatalf("受理错误分类: HTTP %d, %v", tc.status, err)
		}
	}
}
