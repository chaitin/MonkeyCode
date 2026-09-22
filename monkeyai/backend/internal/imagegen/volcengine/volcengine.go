package volcengine

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

type Provider struct{ client *http.Client }

func New(client *http.Client) *Provider { return &Provider{client: client} }

var sizes = map[string]map[string]string{
	"1K": {"1:1": "1024x1024", "4:3": "1152x864", "3:4": "864x1152", "16:9": "1280x720", "9:16": "720x1280", "3:2": "1248x832", "2:3": "832x1248", "21:9": "1344x576"},
	"2K": {"1:1": "2048x2048", "4:3": "2304x1728", "3:4": "1728x2304", "16:9": "2560x1440", "9:16": "1440x2560", "3:2": "2496x1664", "2:3": "1664x2496", "21:9": "2688x1152"},
}

func (p *Provider) Capabilities(model string) (imagegen.Capabilities, error) {
	if model != "doubao-seedream-5-0-pro-260628" {
		return imagegen.Capabilities{}, errors.New("不支持此 Seedream 生图模型版本")
	}
	return imagegen.Capabilities{
		Operations: []string{"generate", "edit"}, Qualities: []string{"1K", "2K"},
		AspectRatios: []string{"1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"},
		MaxCount:     1, MaxReferences: 4, SupportsReference: true,
	}, nil
}

func (p *Provider) Generate(ctx context.Context, target proxy.Target, req imagegen.ProviderRequest) (imagegen.ProviderResult, error) {
	return p.call(ctx, target, req)
}

func (p *Provider) Edit(ctx context.Context, target proxy.Target, req imagegen.ProviderRequest) (imagegen.ProviderResult, error) {
	if len(req.Images) == 0 {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "invalid_reference_image"}, nil
	}
	return p.call(ctx, target, req)
}

func (p *Provider) call(ctx context.Context, target proxy.Target, req imagegen.ProviderRequest) (imagegen.ProviderResult, error) {
	if _, err := p.Capabilities(target.UpstreamModel); err != nil || req.Count != 1 || req.Mask != nil {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "unsupported_image_parameter"}, nil
	}
	size := sizes[req.Quality][req.AspectRatio]
	if size == "" {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "unsupported_image_size"}, nil
	}
	body := map[string]any{"model": target.UpstreamModel, "prompt": req.Prompt, "size": size,
		"response_format": "b64_json", "output_format": "png", "watermark": true}
	if len(req.Images) > 0 {
		images := make([]string, 0, len(req.Images))
		for _, ref := range req.Images {
			if ref.MIMEType != "image/png" && ref.MIMEType != "image/jpeg" {
				return imagegen.ProviderResult{Status: "failed", ErrorCode: "invalid_reference_image"}, nil
			}
			images = append(images, "data:"+ref.MIMEType+";base64,"+base64.StdEncoding.EncodeToString(ref.Data))
		}
		body["image"] = images
	}
	content, status, err := imagegen.Call(ctx, p.client, target, "images/generations", body)
	if err != nil {
		return imagegen.ProviderResult{}, err
	}
	if status >= 400 && status < 500 {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "upstream_rejected"}, nil
	}
	if status < 200 || status >= 300 {
		return imagegen.ProviderResult{}, errors.New("Seedream 上游状态未知")
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
