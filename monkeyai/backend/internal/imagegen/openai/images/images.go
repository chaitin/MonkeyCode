package images

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"strconv"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

type Provider struct{ client *http.Client }

func New(client *http.Client) *Provider { return &Provider{client: client} }

var dimensions = map[string]map[string]string{
	"1K": {
		"1:1": "1024x1024", "4:3": "1152x864", "3:4": "864x1152",
		"16:9": "1280x720", "9:16": "720x1280", "3:2": "1248x832",
		"2:3": "832x1248", "21:9": "1344x576",
	},
	"2K": {
		"1:1": "2048x2048", "4:3": "2304x1728", "3:4": "1728x2304",
		"16:9": "2560x1440", "9:16": "1440x2560", "3:2": "2496x1664",
		"2:3": "1664x2496", "21:9": "2688x1152",
	},
	"4K": {
		"1:1": "4096x4096", "4:3": "4608x3456", "3:4": "3456x4608",
		"16:9": "5120x2880", "9:16": "2880x5120", "3:2": "4992x3328",
		"2:3": "3328x4992", "21:9": "5376x2304",
	},
}

var ratios = []string{"1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"}

func (p *Provider) Capabilities(model string) (imagegen.Capabilities, error) {
	return capabilities(model)
}

func capabilities(model string) (imagegen.Capabilities, error) {
	cap := imagegen.Capabilities{Operations: []string{"generate", "edit"},
		MaxCount: 4, MaxReferences: 4, SupportsMask: true}
	switch model {
	case "gpt-image-2.5-sunburst", "gpt-image-2.5-flare":
		cap.Qualities = []string{"1K", "2K", "4K"}
		cap.AspectRatios = ratios
	case "gpt-image-1":
		cap.Qualities = []string{"1K"}
		cap.AspectRatios = []string{"1:1", "3:2", "2:3"}
	default:
		return imagegen.Capabilities{}, errors.New("不支持此 GPT Image 模型版本")
	}
	return cap, nil
}

func Size(model, quality, aspect string) (string, error) {
	cap, err := capabilities(model)
	if err != nil {
		return "", err
	}
	for _, q := range cap.Qualities {
		if q == quality {
			for _, a := range cap.AspectRatios {
				if a == aspect {
					if model == "gpt-image-1" {
						switch aspect {
						case "1:1":
							return "1024x1024", nil
						case "3:2":
							return "1536x1024", nil
						case "2:3":
							return "1024x1536", nil
						}
					}
					return dimensions[quality][aspect], nil
				}
			}
		}
	}
	return "", errors.New("不支持此 GPT Image 画质比例组合")
}

func (p *Provider) Generate(ctx context.Context, target proxy.Target, req imagegen.ProviderRequest) (imagegen.ProviderResult, error) {
	if len(req.Images) != 0 {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "references_not_supported"}, nil
	}
	size, err := Size(target.UpstreamModel, req.Quality, req.AspectRatio)
	if err != nil {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "unsupported_image_size"}, nil
	}
	response, status, err := imagegen.Call(ctx, p.client, target, "images/generations", map[string]any{
		"model": target.UpstreamModel, "prompt": req.Prompt, "size": size,
		"quality": "medium", "output_format": "png", "n": req.Count,
	})
	return decode(response, status, err)
}

func (p *Provider) Edit(ctx context.Context, target proxy.Target, req imagegen.ProviderRequest) (imagegen.ProviderResult, error) {
	if len(req.Images) < 1 || len(req.Images) > 4 {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "invalid_reference_image"}, nil
	}
	size, err := Size(target.UpstreamModel, req.Quality, req.AspectRatio)
	if err != nil {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "unsupported_image_size"}, nil
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	for i, input := range req.Images {
		filename := fmt.Sprintf("image-%d.png", i)
		if input.MIMEType == "image/jpeg" {
			filename = fmt.Sprintf("image-%d.jpg", i)
		} else if input.MIMEType == "image/webp" {
			filename = fmt.Sprintf("image-%d.webp", i)
		}
		part, err := form.CreateFormFile("image[]", filename)
		if err != nil {
			return imagegen.ProviderResult{}, err
		}
		if _, err := part.Write(input.Data); err != nil {
			return imagegen.ProviderResult{}, err
		}
	}
	if req.Mask != nil {
		if req.Mask.MIMEType != "image/png" {
			return imagegen.ProviderResult{Status: "failed", ErrorCode: "invalid_mask"}, nil
		}
		part, err := form.CreateFormFile("mask", "mask.png")
		if err != nil {
			return imagegen.ProviderResult{}, err
		}
		if _, err := part.Write(req.Mask.Data); err != nil {
			return imagegen.ProviderResult{}, err
		}
	}
	for k, value := range map[string]string{"model": target.UpstreamModel, "prompt": req.Prompt,
		"size": size, "quality": "medium", "output_format": "png", "n": strconv.FormatUint(uint64(req.Count), 10)} {
		if err := form.WriteField(k, value); err != nil {
			return imagegen.ProviderResult{}, err
		}
	}
	if err := form.Close(); err != nil {
		return imagegen.ProviderResult{}, err
	}
	response, status, err := imagegen.CallBody(ctx, p.client, target, "images/edits", body.Bytes(), form.FormDataContentType())
	return decode(response, status, err)
}

func decode(body []byte, status int, err error) (imagegen.ProviderResult, error) {
	if err != nil {
		return imagegen.ProviderResult{}, err
	}
	if status >= 400 && status < 500 {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "upstream_rejected"}, nil
	}
	if status < 200 || status >= 300 {
		return imagegen.ProviderResult{}, errors.New("GPT Image 上游状态未知")
	}
	var payload struct {
		Data []struct {
			Base64 string `json:"b64_json"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return imagegen.ProviderResult{}, err
	}
	if len(payload.Data) == 0 {
		return imagegen.ProviderResult{Status: "failed", ErrorCode: "content_rejected"}, nil
	}
	images := make([]imagegen.Image, 0, len(payload.Data))
	for _, item := range payload.Data {
		imageBytes, err := imagegen.DecodeImage(item.Base64)
		if err != nil {
			return imagegen.ProviderResult{}, err
		}
		images = append(images, imagegen.Image{Data: imageBytes})
	}
	return imagegen.ProviderResult{Status: "succeeded", Images: images}, nil
}
