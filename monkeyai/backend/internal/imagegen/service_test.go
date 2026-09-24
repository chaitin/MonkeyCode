package imagegen

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"sync"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imageproxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
)

type modelReaderFunc func(context.Context, string) (model.Model, error)

func (f modelReaderFunc) Get(ctx context.Context, id string) (model.Model, error) { return f(ctx, id) }

type testJobs struct {
	sync.Mutex
	job Job
}

func (s *testJobs) Create(_ context.Context, job Job) (Job, bool, error) {
	s.Lock()
	defer s.Unlock()
	if s.job.ID != "" {
		if s.job.RequestHash != job.RequestHash {
			return Job{}, false, errors.New("hash conflict")
		}
		return s.job, false, nil
	}
	job.ID = "job-1"
	job.Status = "created"
	s.job = job
	return job, true, nil
}
func (s *testJobs) Get(_ context.Context, userID, _ string) (Job, error) {
	s.Lock()
	defer s.Unlock()
	if userID != s.job.UserID {
		return Job{}, errors.New("wrong owner")
	}
	return s.job, nil
}
func (*testJobs) LinkInputs(context.Context, string, []string) error { return nil }
func (s *testJobs) Reserve(_ context.Context, _ Job, tx string) error {
	s.Lock()
	defer s.Unlock()
	if tx != "" {
		s.job.BillingTransactionID = &tx
	}
	s.job.Status = "reserved"
	return nil
}
func (s *testJobs) Submitted(context.Context, string) error {
	s.Lock()
	defer s.Unlock()
	s.job.Status = "submitted"
	return nil
}
func (s *testJobs) Running(_ context.Context, _, id string) error {
	s.Lock()
	defer s.Unlock()
	s.job.ProviderJobID = &id
	s.job.Status = "running"
	return nil
}
func (s *testJobs) Unknown(context.Context, string, string) error {
	s.Lock()
	defer s.Unlock()
	s.job.Status = "unknown"
	return nil
}
func (s *testJobs) Finish(_ context.Context, _, status, _ string, count int32, _ any) error {
	s.Lock()
	defer s.Unlock()
	s.job.Status = status
	s.job.GeneratedImages = count
	return nil
}
func (*testJobs) Recover(context.Context, int32) ([]Job, error)        { return nil, nil }
func (*testJobs) PendingBilling(context.Context, int32) ([]Job, error) { return nil, nil }

type testInputs struct{}

func (*testInputs) Read(context.Context, string, string) (Input, error) { return Input{}, nil }

type testOutputs struct {
	sync.Mutex
	saved []SavedOutput
}

func (s *testOutputs) Save(_ context.Context, _ string, _ int32, img Image) (SavedOutput, error) {
	s.Lock()
	defer s.Unlock()
	o := SavedOutput{ID: "output-1", MIMEType: "image/png", Width: img.Width, Height: img.Height, ExpiresAt: time.Now().Add(time.Hour)}
	s.saved = append(s.saved, o)
	return o, nil
}
func (s *testOutputs) List(context.Context, string) ([]SavedOutput, error) {
	s.Lock()
	defer s.Unlock()
	return append([]SavedOutput(nil), s.saved...), nil
}

type testBilling struct {
	sync.Mutex
	begun    []billing.Request
	finished []billing.Usage
}

func (s *testBilling) Begin(_ context.Context, r billing.Request) (billing.Reservation, error) {
	s.Lock()
	defer s.Unlock()
	s.begun = append(s.begun, r)
	return billing.Reservation{ID: "tx-1"}, nil
}
func (*testBilling) Start(context.Context, string) error { return nil }
func (s *testBilling) ImageCharge(_ context.Context, _, _ string) (billing.Amount, error) {
	s.Lock()
	defer s.Unlock()
	if len(s.finished) == 0 || !s.finished[0].Known {
		return 0, errors.New("not settled")
	}
	return billing.Amount(int64(s.begun[0].ImageUnitPrice) * s.finished[0].Images), nil
}
func (s *testBilling) Finish(_ context.Context, _ string, u billing.Usage) error {
	s.Lock()
	defer s.Unlock()
	s.finished = append(s.finished, u)
	return nil
}

type generatorFunc func(context.Context, proxy.Target, ProviderRequest) (ProviderResult, error)

func (f generatorFunc) Generate(ctx context.Context, t proxy.Target, r ProviderRequest) (ProviderResult, error) {
	return f(ctx, t, r)
}

func testImageService(call generatorFunc) (*Service, *testJobs, *testBilling) {
	models := modelReaderFunc(func(_ context.Context, id string) (model.Model, error) {
		return model.Model{
			ID: id, ModelID: "upstream", Kind: model.KindImage, Protocol: model.ProtocolImage, Provider: model.ProviderOpenAIImages,
			ImageConfig:  &model.ImageConfig{Qualities: []string{"1K"}, AspectRatios: []string{"1:1"}, DefaultQuality: "1K", DefaultAspectRatio: "1:1"},
			ImagePricing: &model.ImagePricing{BaseCreditsPerImage: "10"},
		}, nil
	})
	jobs, bills := &testJobs{}, &testBilling{}
	svc := NewService(models, jobs, &testInputs{}, &testOutputs{}, bills).WithAdapter(model.ProviderOpenAIImages, Adapter{
		Capabilities: func(string) (Capabilities, error) {
			return Capabilities{Operations: []string{"generate"}, Qualities: []string{"1K"}, AspectRatios: []string{"1:1"}, MaxCount: 2}, nil
		}, Generator: call,
	})
	return svc, jobs, bills
}

func TestCapabilitiesUsesProviderDefaultWithoutModel(t *testing.T) {
	modelSpecificCalled := false
	svc := NewService(nil, nil, nil, nil, nil).WithAdapter(model.ProviderXAI, Adapter{
		Capabilities: func(string) (Capabilities, error) {
			modelSpecificCalled = true
			return Capabilities{}, nil
		},
		DefaultCapabilities: func() Capabilities {
			return Capabilities{Qualities: []string{"1K", "2K", "4K"}, AspectRatios: []string{"1:1", "16:9"}}
		},
	})
	cap, err := svc.Capabilities(model.ProviderXAI, " ")
	if err != nil || modelSpecificCalled || len(cap.Qualities) != 3 || len(cap.AspectRatios) != 2 {
		t.Fatalf("供应商默认能力错误: %+v, %v", cap, err)
	}
}

func TestUserImageModelSkipsBillingAndKeepsJobUsage(t *testing.T) {
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	svc, jobs, _ := testImageService(generatorFunc(func(_ context.Context, _ proxy.Target, _ ProviderRequest) (ProviderResult, error) {
		return ProviderResult{Status: "succeeded", Images: []Image{{Data: imageBytes.Bytes(), Width: 2, Height: 2}}}, nil
	}))
	svc.models = modelReaderFunc(func(_ context.Context, id string) (model.Model, error) {
		return model.Model{ID: id, ModelID: "upstream", OwnershipType: "user", Kind: model.KindImage,
			Protocol: model.ProtocolImage, Provider: model.ProviderOpenAIImages,
			ImageConfig:  &model.ImageConfig{Qualities: []string{"1K"}, AspectRatios: []string{"1:1"}, DefaultQuality: "1K", DefaultAspectRatio: "1:1"},
			ImagePricing: &model.ImagePricing{BaseCreditsPerImage: "0"}}, nil
	})
	svc.billing = nil
	target := proxy.Target{ModelID: "model-1", UpstreamModel: "upstream", UserID: "owner", Protocol: "image_generation"}
	result, err := svc.Generate(t.Context(), target, imageproxy.GenerateRequest{Model: "image@model-1", Prompt: "猫"})
	if err != nil || result.Status != "pending" {
		t.Fatalf("自配生图受理失败: %+v, %v", result, err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	if err := svc.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	jobs.Lock()
	defer jobs.Unlock()
	if jobs.job.Status != "succeeded" || jobs.job.GeneratedImages != 1 || jobs.job.BillingTransactionID != nil {
		t.Fatalf("自配生图应保留任务统计但不创建计费交易: %+v", jobs.job)
	}
}

func TestGenerateReservesAndSettlesActualImages(t *testing.T) {
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	svc, jobs, bills := testImageService(generatorFunc(func(_ context.Context, _ proxy.Target, req ProviderRequest) (ProviderResult, error) {
		if req.Count != 2 || req.Prompt != "猫" || req.Quality != "1K" {
			t.Errorf("生成参数错误: %+v", req)
		}
		return ProviderResult{Status: "succeeded", Images: []Image{{Data: imageBytes.Bytes(), Width: 2, Height: 2}}}, nil
	}))
	count := uint32(2)
	target := proxy.Target{ModelID: "model-1", UpstreamModel: "upstream", UserID: "owner", Protocol: "image_generation"}
	result, err := svc.Generate(t.Context(), target, imageproxy.GenerateRequest{Model: "image@model-1", Prompt: "猫", Count: &count, IdempotencyKey: "idem"})
	if err != nil || result.ID != "job-1" || result.Status != "pending" {
		t.Fatalf("任务受理失败: %+v, %v", result, err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	if err := svc.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	jobs.Lock()
	status, generated := jobs.job.Status, jobs.job.GeneratedImages
	jobs.Unlock()
	if status != "succeeded" || generated != 1 {
		t.Fatalf("部分成功处理错误: %s/%d", status, generated)
	}
	bills.Lock()
	if len(bills.begun) != 1 || bills.begun[0].ImageCount != 2 || bills.begun[0].ImageUnitPrice.String() != "10" ||
		len(bills.finished) != 1 || bills.finished[0].Images != 1 || !bills.finished[0].Known {
		t.Fatalf("预留或结算错误: %+v %+v", bills.begun, bills.finished)
	}
	bills.Unlock()
	duplicate, err := svc.Generate(t.Context(), target, imageproxy.GenerateRequest{Model: "image@model-1", Prompt: "猫", Count: &count, IdempotencyKey: "idem"})
	if err != nil || duplicate.ID != "job-1" || duplicate.Usage.Credits != "10" {
		t.Fatalf("幂等重试或积分结果错误: %+v %v", duplicate, err)
	}
	bills.Lock()
	defer bills.Unlock()
	if len(bills.begun) != 1 {
		t.Fatalf("重复冻结积分: %d", len(bills.begun))
	}
}

func TestProviderUnknownKeepsReservation(t *testing.T) {
	svc, jobs, bills := testImageService(generatorFunc(func(context.Context, proxy.Target, ProviderRequest) (ProviderResult, error) {
		return ProviderResult{}, errors.New("timeout")
	}))
	_, err := svc.Generate(t.Context(), proxy.Target{ModelID: "model-1", UpstreamModel: "upstream", UserID: "owner"}, imageproxy.GenerateRequest{Model: "image", Prompt: "test"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	if err := svc.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	jobs.Lock()
	status := jobs.job.Status
	jobs.Unlock()
	bills.Lock()
	defer bills.Unlock()
	if status != "unknown" || len(bills.finished) != 1 || bills.finished[0].Known {
		t.Fatalf("未知结果被错误退款: %s %+v", status, bills.finished)
	}
}

func TestRejectedGenerationReleasesCredits(t *testing.T) {
	svc, jobs, bills := testImageService(generatorFunc(func(context.Context, proxy.Target, ProviderRequest) (ProviderResult, error) {
		return ProviderResult{Status: "failed", ErrorCode: "content_rejected"}, nil
	}))
	_, err := svc.Generate(t.Context(), proxy.Target{ModelID: "model-1", UpstreamModel: "upstream", UserID: "owner"}, imageproxy.GenerateRequest{Model: "image", Prompt: "test"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	if err := svc.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	jobs.Lock()
	status := jobs.job.Status
	jobs.Unlock()
	bills.Lock()
	defer bills.Unlock()
	if status != "failed" || len(bills.finished) != 1 || !bills.finished[0].Known || bills.finished[0].Images != 0 {
		t.Fatalf("审核拒绝未退款: %s %+v", status, bills.finished)
	}
}
