package agnes

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

const modelID = "agnes-image-2.5-flash"

var ratios = []string{"1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"}

// Provider implements Agnes Image 2.5 Flash's OpenAI-compatible image endpoint.
type Provider struct{ client *http.Client }

func New(client *http.Client) *Provider { return &Provider{client: client} }

func (p *Provider) DefaultCapabilities() imagegen.Capabilities {
	return imagegen.Capabilities{
		Operations: []string{"generate", "edit"}, Qualities: []string{"1K", "2K", "4K"},
		AspectRatios: ratios, MaxCount: 1, MaxReferences: 8, SupportsReference: true,
	}
}

func (p *Provider) Capabilities(model string) (imagegen.Capabilities, error) {
	if model != "" && model != modelID {
		return imagegen.Capabilities{}, errors.New("Agnes 生图型号不受支持")
	}
	return p.DefaultCapabilities(), nil
}

func (p *Provider) Generate(ctx context.Context, target proxy.Target, req imagegen.ProviderRequest) (imagegen.ProviderResult, error) {
	return p.call(ctx, target, req)
}

func (p *Provider) Edit(ctx context.Context, target proxy.Target, req imagegen.ProviderRequest) (imagegen.ProviderResult, error) {
	if len(req.Images) == 0 || req.Mask != nil {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "invalid_reference_image"}, nil
	}
	return p.call(ctx, target, req)
}

func (p *Provider) call(ctx context.Context, target proxy.Target, req imagegen.ProviderRequest) (imagegen.ProviderResult, error) {
	if req.Count != 1 || req.Quality == "3K" {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "unsupported_image_parameter"}, nil
	}
	body := map[string]any{
		"model": target.UpstreamModel, "prompt": req.Prompt, "size": req.Quality, "ratio": req.AspectRatio,
	}
	extra := map[string]any{"response_format": "b64_json"}
	if len(req.Images) > 0 {
		images := make([]string, 0, len(req.Images))
		for _, ref := range req.Images {
			if ref.MIMEType != "image/png" && ref.MIMEType != "image/jpeg" && ref.MIMEType != "image/webp" {
				return imagegen.ProviderResult{Status: "failed", ErrorCode: "invalid_reference_image"}, nil
			}
			images = append(images, "data:"+ref.MIMEType+";base64,"+base64.StdEncoding.EncodeToString(ref.Data))
		}
		extra["image"] = images
	} else {
		body["return_base64"] = true
	}
	body["extra_body"] = extra
	content, status, err := imagegen.Call(ctx, p.client, target, "images/generations", body)
	if err != nil {
		return imagegen.ProviderResult{}, err
	}
	if status >= 400 && status < 500 {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "upstream_rejected"}, nil
	}
	if status < 200 || status >= 300 {
		return imagegen.ProviderResult{}, errors.New("Agnes 生图上游状态未知")
	}
	var response struct {
		Data []struct {
			Base64 string `json:"b64_json"`
		} `json:"data"`
	}
	if err := json.Unmarshal(content, &response); err != nil {
		return imagegen.ProviderResult{}, err
	}
	if len(response.Data) == 0 || strings.TrimSpace(response.Data[0].Base64) == "" {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "image_not_generated"}, nil
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
