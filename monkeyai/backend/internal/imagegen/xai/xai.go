package xai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

type Provider struct{ client *http.Client }

func New(client *http.Client) *Provider { return &Provider{client: client} }

var ratios = []string{"1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"}

func (p *Provider) DefaultCapabilities() imagegen.Capabilities {
	return imagegen.Capabilities{Operations: []string{"generate"}, Qualities: []string{"1K", "2K", "4K"},
		AspectRatios: ratios, MaxCount: 4}
}

func (p *Provider) Capabilities(model string) (imagegen.Capabilities, error) {
	if model != "grok-imagine-image-2.0" {
		return imagegen.Capabilities{}, errors.New("不支持此 Grok 生图模型版本")
	}
	return p.DefaultCapabilities(), nil
}

func (p *Provider) Generate(ctx context.Context, target proxy.Target, req imagegen.ProviderRequest) (imagegen.ProviderResult, error) {
	cap, err := p.Capabilities(target.UpstreamModel)
	if err != nil || !slices.Contains(cap.Qualities, req.Quality) || !slices.Contains(cap.AspectRatios, req.AspectRatio) || len(req.Images) != 0 {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "unsupported_image_parameter"}, nil
	}
	content, status, err := imagegen.Call(ctx, p.client, target, "images/generations", map[string]any{
		"model": target.UpstreamModel, "prompt": req.Prompt, "n": req.Count,
		"aspect_ratio": req.AspectRatio, "resolution": strings.ToLower(req.Quality),
		"quality": "medium", "response_format": "b64_json",
	})
	if err != nil {
		return imagegen.ProviderResult{}, err
	}
	if status >= 400 && status < 500 {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "upstream_rejected"}, nil
	}
	if status < 200 || status >= 300 {
		return imagegen.ProviderResult{}, errors.New("Grok 生图上游状态未知")
	}
	var response struct {
		Data []struct {
			Base64 string `json:"b64_json"`
		} `json:"data"`
	}
	if err := json.Unmarshal(content, &response); err != nil {
		return imagegen.ProviderResult{}, err
	}
	if len(response.Data) == 0 {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "content_rejected"}, nil
	}
	images := make([]imagegen.Image, 0, len(response.Data))
	for _, data := range response.Data {
		decoded, err := imagegen.DecodeImage(data.Base64)
		if err != nil {
			return imagegen.ProviderResult{}, err
		}
		images = append(images, imagegen.Image{Data: decoded})
	}
	return imagegen.ProviderResult{Status: "succeeded", Images: images}, nil
}
