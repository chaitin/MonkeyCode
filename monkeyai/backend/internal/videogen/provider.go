package videogen

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

type Reference struct {
	Role     string `json:"role"`
	FileID   string `json:"file_id"`
	MIMEType string `json:"-"`
	Data     []byte `json:"-"`
}

type GenerateInput struct {
	Model      string                     `json:"model"`
	Mode       model.VideoMode            `json:"mode"`
	Prompt     string                     `json:"prompt"`
	Params     map[string]json.RawMessage `json:"params"`
	References []Reference                `json:"references,omitempty"`
}

type providerRejected struct{ status int }

func (e providerRejected) Error() string {
	return fmt.Sprintf("视频供应商拒绝请求: HTTP %d", e.status)
}

type providerResult struct {
	Status     string
	JobID      string
	URL        string
	DurationMs int64
}

func submitProvider(ctx context.Context, client *http.Client, target proxy.Target, input GenerateInput) (string, error) {
	seconds, err := model.VideoDuration(input.Params)
	if err != nil {
		return "", err
	}
	resolution := model.VideoResolution(input.Params)
	var ratio string
	if err := json.Unmarshal(input.Params["aspect_ratio"], &ratio); err != nil {
		return "", err
	}
	var endpoint string
	var body any
	switch target.UpstreamModel {
	case "grok-imagine-video-1.5":
		endpoint = "/v1/videos/generations"
		request := map[string]any{"model": target.UpstreamModel, "prompt": input.Prompt, "duration": seconds, "resolution": resolution}
		if ratio != "adaptive" {
			request["aspect_ratio"] = ratio
		}
		images := make([]map[string]string, 0, len(input.References))
		for _, ref := range input.References {
			uri := "data:" + ref.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(ref.Data)
			if ref.Role == "first_frame" {
				request["image"] = map[string]string{"url": uri}
			} else {
				images = append(images, map[string]string{"url": uri})
			}
		}
		if len(images) > 0 {
			request["reference_images"] = images
		}
		body = request
	case "MiniMax-H3":
		endpoint = "/v2/video_generation"
		content := []map[string]any{{"type": "text", "text": input.Prompt}}
		for _, ref := range input.References {
			uri := "data:" + ref.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(ref.Data)
			content = append(content, map[string]any{"type": "image_url", "role": ref.Role, "image_url": map[string]string{"url": uri}})
		}
		body = map[string]any{"model": target.UpstreamModel, "content": content, "duration": seconds, "resolution": resolution, "ratio": ratio}
	default:
		return "", errors.New("视频供应商型号不受支持")
	}
	content, status, err := providerJSON(ctx, client, http.MethodPost, target.BaseURL, endpoint, target.APIKey, body)
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		if status >= 400 && status < 500 && status != http.StatusTooManyRequests {
			return "", providerRejected{status: status}
		}
		return "", fmt.Errorf("视频供应商受理结果未知: HTTP %d", status)
	}
	var response struct {
		RequestID string `json:"request_id"`
		TaskID    string `json:"task_id"`
		BaseResp  struct {
			StatusCode int `json:"status_code"`
		} `json:"base_resp"`
	}
	if json.Unmarshal(content, &response) != nil || response.BaseResp.StatusCode != 0 {
		return "", errors.New("视频供应商受理响应无效")
	}
	id := response.RequestID
	if target.UpstreamModel == "MiniMax-H3" {
		id = response.TaskID
	}
	if _, err := providerTaskPath(id); err != nil {
		return "", err
	}
	return id, nil
}

func queryProvider(ctx context.Context, client *http.Client, target proxy.Target, id string) (providerResult, error) {
	path, err := providerTaskPath(id)
	if err != nil {
		return providerResult{}, err
	}
	var endpoint string
	switch target.UpstreamModel {
	case "grok-imagine-video-1.5":
		endpoint = "/v1/videos/" + path
	case "MiniMax-H3":
		endpoint = "/v2/query/video_generation/" + path
	default:
		return providerResult{}, errors.New("视频供应商型号不受支持")
	}
	content, code, err := providerJSON(ctx, client, http.MethodGet, target.BaseURL, endpoint, target.APIKey, nil)
	if err != nil {
		return providerResult{}, err
	}
	if code < 200 || code >= 300 {
		return providerResult{}, fmt.Errorf("视频供应商查询失败: HTTP %d", code)
	}
	var response struct {
		Status string `json:"status"`
		Video  struct {
			URL      string      `json:"url"`
			Duration json.Number `json:"duration"`
		} `json:"video"`
		Task struct {
			Status  string `json:"status"`
			Content struct {
				URL string `json:"url"`
			} `json:"content"`
			Duration json.Number `json:"duration"`
		} `json:"task"`
		BaseResp struct {
			StatusCode int `json:"status_code"`
		} `json:"base_resp"`
	}
	if json.Unmarshal(content, &response) != nil || response.BaseResp.StatusCode != 0 {
		return providerResult{}, errors.New("视频供应商查询响应无效")
	}
	result := providerResult{JobID: id, Status: strings.ToLower(response.Status), URL: response.Video.URL}
	value := response.Video.Duration
	if target.UpstreamModel == "MiniMax-H3" {
		result.Status, result.URL, value = strings.ToLower(response.Task.Status), response.Task.Content.URL, response.Task.Duration
	}
	switch result.Status {
	case "done", "succeeded":
		result.Status = "succeeded"
		result.DurationMs, err = durationMillis(value)
		if err != nil || result.URL == "" {
			return providerResult{}, errors.New("视频供应商未提供可验证的结果")
		}
	case "failed", "expired":
		result.Status = "failed"
	case "pending", "queued", "processing", "running", "created":
		result.Status = "running"
	default:
		return providerResult{}, errors.New("视频供应商状态未知")
	}
	return result, nil
}
