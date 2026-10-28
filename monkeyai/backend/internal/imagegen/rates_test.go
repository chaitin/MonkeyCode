package imagegen

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imageproxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

func TestQuoteIndependentImageRates(t *testing.T) {
	item := model.Model{Kind: model.KindImage,
		ImageConfig:  &model.ImageConfig{Qualities: []string{"1K", "2K", "4K"}, AspectRatios: []string{"1:1", "16:9"}},
		ImagePricing: &model.ImagePricing{Rates: []model.ImageRate{{Quality: "1K", CreditsPerImage: "0"}, {Quality: "2K", CreditsPerImage: "7.123456"}, {Quality: "4K", CreditsPerImage: "19"}}},
	}
	for _, operation := range []string{"generate", "edit"} {
		for _, rate := range item.ImagePricing.Rates {
			quoted, err := Quote(item, operation, rate.Quality, "16:9")
			if err != nil || quoted.String() != rate.CreditsPerImage {
				t.Fatalf("独立单张价格错误: %s %s %v", rate.Quality, quoted, err)
			}
		}
	}
	item.ImagePricing.Rates = item.ImagePricing.Rates[:1]
	if _, err := Quote(item, "generate", "2K", "1:1"); err == nil {
		t.Fatal("缺失价格不能回退为零或倍率价")
	}
}

func TestGenerateReservesAndSettlesIndependentImagePrice(t *testing.T) {
	for _, price := range []string{"7.123456", "0"} {
		t.Run(price, func(t *testing.T) {
			var imageBytes bytes.Buffer
			if err := png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
				t.Fatal(err)
			}
			svc, jobs, bills := testImageService(generatorFunc(func(context.Context, proxy.Target, ProviderRequest) (ProviderResult, error) {
				return ProviderResult{Status: "succeeded", Images: []Image{{Data: imageBytes.Bytes(), Width: 2, Height: 2}}}, nil
			}))
			reader := svc.models
			svc.models = modelReaderFunc(func(ctx context.Context, id string) (model.Model, error) {
				item, err := reader.Get(ctx, id)
				item.ImagePricing = &model.ImagePricing{Rates: []model.ImageRate{{Quality: "1K", CreditsPerImage: price}}}
				return item, err
			})
			count := uint32(2)
			target := proxy.Target{ModelID: "model-1", UpstreamModel: "upstream", UserID: "owner", Protocol: "image_generation"}
			if _, err := svc.Generate(t.Context(), target, imageproxy.GenerateRequest{Model: "image@model-1", Prompt: "猫", Count: &count, IdempotencyKey: "rate-test"}); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), time.Second)
			defer cancel()
			if err := svc.Wait(ctx); err != nil {
				t.Fatal(err)
			}
			bills.Lock()
			defer bills.Unlock()
			if len(bills.begun) != 1 || bills.begun[0].ImageCount != 2 || bills.begun[0].ImageUnitPrice.String() != price || len(bills.finished) != 1 || bills.finished[0].Images != 1 {
				t.Fatalf("预扣和实际生成结算未使用单张价格: %+v %+v", bills.begun, bills.finished)
			}
			jobs.Lock()
			defer jobs.Unlock()
			if jobs.job.Status != "succeeded" || jobs.job.GeneratedImages != 1 {
				t.Fatalf("任务未完成: %+v", jobs.job)
			}
		})
	}
}
