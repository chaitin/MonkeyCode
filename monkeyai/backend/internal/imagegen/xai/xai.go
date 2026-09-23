package xai

import (
	"context"
	"encoding/base64"
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
	return imagegen.Capabilities{Operations: []string{"generate", "edit"}, Qualities: []string{"1K", "2K", "4K"},
		AspectRatios: ratios, MaxCount: 4, MaxReferences: 5, SupportsReference: true}
}

func (p *Provider) Capabilities(string) (imagegen.Capabilities, error) {
	return p.DefaultCapabilities(), nil
}

func (p *Provider) Generate(ctx context.Context, target proxy.Target, req imagegen.ProviderRequest) (imagegen.ProviderResult, error) {
	cap, err := p.Capabilities(target.UpstreamModel)
	if err != nil || !slices.Contains(cap.Qualities, req.Quality) || !slices.Contains(cap.AspectRatios, req.AspectRatio) || len(req.Images) != 0 {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "unsupported_image_parameter"}, nil
	}
	return p.call(ctx, target, "images/generations", map[string]any{
		"model": target.UpstreamModel, "prompt": req.Prompt, "n": req.Count,
		"aspect_ratio": req.AspectRatio, "resolution": strings.ToLower(req.Quality),
		"quality": "medium", "response_format": "b64_json",
	})
}

func (p *Provider) Edit(ctx context.Context, target proxy.Target, req imagegen.ProviderRequest) (imagegen.ProviderResult, error) {
	cap, err := p.Capabilities(target.UpstreamModel)
	if err != nil || !slices.Contains(cap.Qualities, req.Quality) || !slices.Contains(cap.AspectRatios, req.AspectRatio) ||
		len(req.Images) == 0 || len(req.Images) > cap.MaxReferences || req.Mask != nil {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "invalid_reference_image"}, nil
	}
	references := make([]map[string]string, 0, len(req.Images))
	for _, input := range req.Images {
		if len(input.Data) == 0 || !strings.HasPrefix(input.MIMEType, "image/") {
			return imagegen.ProviderResult{Status: "failed", ErrorCode: "invalid_reference_image"}, nil
		}
		references = append(references, map[string]string{
			"type": "image_url",
			"url":  "data:" + input.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(input.Data),
		})
	}
	body := map[string]any{
		"model": target.UpstreamModel, "prompt": req.Prompt, "n": req.Count,
		"aspect_ratio": req.AspectRatio, "resolution": strings.ToLower(req.Quality),
		"quality": "medium", "response_format": "b64_json",
	}
	if len(references) == 1 {
		body["image"] = references[0]
	} else {
		body["images"] = references
	}
	return p.call(ctx, target, "images/edits", body)
}

func (p *Provider) call(ctx context.Context, target proxy.Target, endpoint string, body map[string]any) (imagegen.ProviderResult, error) {
	content, status, err := imagegen.Call(ctx, p.client, target, endpoint, body)
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
