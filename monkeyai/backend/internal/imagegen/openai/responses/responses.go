package responses

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen/openai/images"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

type Provider struct{ client *http.Client }

func New(client *http.Client) *Provider { return &Provider{client: client} }

func (p *Provider) DefaultCapabilities() imagegen.Capabilities {
	return imagegen.Capabilities{
		Operations: []string{"generate", "edit"}, Qualities: []string{"1K", "2K", "4K"},
		AspectRatios: []string{"1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"},
		MaxCount:     1, MaxReferences: 4, SupportsReference: true,
	}
}

func (p *Provider) Capabilities(model string) (imagegen.Capabilities, error) {
	switch model {
	case "gpt-5", "gpt-5.1", "gpt-5.2", "gpt-6-astra":
		return p.DefaultCapabilities(), nil
	default:
		return imagegen.Capabilities{}, errors.New("不支持此 Responses 生图模型版本")
	}
}

func (p *Provider) Generate(ctx context.Context, target proxy.Target, req imagegen.ProviderRequest) (imagegen.ProviderResult, error) {
	return p.call(ctx, target, req, "generate")
}

func (p *Provider) Edit(ctx context.Context, target proxy.Target, req imagegen.ProviderRequest) (imagegen.ProviderResult, error) {
	if len(req.Images) == 0 || req.Mask != nil {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "invalid_reference_image"}, nil
	}
	return p.call(ctx, target, req, "edit")
}

func (p *Provider) call(ctx context.Context, target proxy.Target, req imagegen.ProviderRequest, action string) (imagegen.ProviderResult, error) {
	if _, err := p.Capabilities(target.UpstreamModel); err != nil {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "unsupported_model"}, nil
	}
	size, err := images.Size("gpt-image-2.5-sunburst", req.Quality, req.AspectRatio)
	if err != nil {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "unsupported_image_size"}, nil
	}
	contents := []map[string]string{{"type": "input_text", "text": req.Prompt}}
	for _, ref := range req.Images {
		if ref.MIMEType != "image/png" && ref.MIMEType != "image/jpeg" {
			return imagegen.ProviderResult{Status: "failed", ErrorCode: "invalid_reference_image"}, nil
		}
		contents = append(contents, map[string]string{
			"type": "input_image", "image_url": "data:" + ref.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(ref.Data),
		})
	}
	body := map[string]any{
		"model":       target.UpstreamModel,
		"input":       []any{map[string]any{"role": "user", "content": contents}},
		"tool_choice": "required",
		"tools": []map[string]string{{"type": "image_generation", "model": "gpt-image-2.5-sunburst",
			"action": action, "size": size, "quality": "medium", "output_format": "png"}},
	}
	content, status, err := imagegen.Call(ctx, p.client, target, "responses", body)
	if err != nil {
		return imagegen.ProviderResult{}, err
	}
	if status >= 400 && status < 500 {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "upstream_rejected"}, nil
	}
	if status < 200 || status >= 300 {
		return imagegen.ProviderResult{}, errors.New("Responses 生图上游状态未知")
	}
	var response struct {
		ID     string `json:"id"`
		Output []struct {
			Type   string `json:"type"`
			Status string `json:"status"`
			Result string `json:"result"`
		} `json:"output"`
	}
	if err := json.Unmarshal(content, &response); err != nil {
		return imagegen.ProviderResult{}, err
	}
	for _, output := range response.Output {
		if output.Type != "image_generation_call" {
			continue
		}
		if output.Status == "failed" {
			return imagegen.ProviderResult{Status: "failed", ErrorCode: "content_rejected", RequestID: response.ID}, nil
		}
		imageBytes, err := imagegen.DecodeImage(output.Result)
		if err != nil {
			return imagegen.ProviderResult{}, err
		}
		return imagegen.ProviderResult{Status: "succeeded", RequestID: response.ID,
			Images: []imagegen.Image{{Data: imageBytes}}}, nil
	}
	return imagegen.ProviderResult{Status: "failed", ErrorCode: "image_not_generated", RequestID: response.ID}, nil
}
