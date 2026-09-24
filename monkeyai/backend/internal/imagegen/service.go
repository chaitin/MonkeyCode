package imagegen

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imageproxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type Capabilities struct {
	Operations        []string
	Qualities         []string
	AspectRatios      []string
	AllowedRatios     map[string][]string
	MaxCount          uint32
	MaxReferences     int
	SupportsReference bool
	SupportsMask      bool
}

type ProviderRequest struct {
	Prompt      string
	Quality     string
	AspectRatio string
	Count       uint32
	Images      []Input
	Mask        *Input
}

type ProviderResult struct {
	ID        string
	RequestID string
	Status    string
	Images    []Image
	ErrorCode string
}

type Generator interface {
	Generate(context.Context, proxy.Target, ProviderRequest) (ProviderResult, error)
}

type Editor interface {
	Edit(context.Context, proxy.Target, ProviderRequest) (ProviderResult, error)
}

type TaskQuerier interface {
	QueryTask(context.Context, proxy.Target, string) (ProviderResult, error)
}

type Adapter struct {
	Capabilities        func(string) (Capabilities, error)
	DefaultCapabilities func() Capabilities
	Generator           Generator
	Editor              Editor
	TaskQuerier         TaskQuerier
}

type ModelReader interface {
	Get(context.Context, string) (model.Model, error)
}

type Jobs interface {
	Create(context.Context, Job) (Job, bool, error)
	Get(context.Context, string, string) (Job, error)
	LinkInputs(context.Context, string, []string) error
	Reserve(context.Context, Job, string) error
	Submitted(context.Context, string) error
	Running(context.Context, string, string) error
	Unknown(context.Context, string, string) error
	Finish(context.Context, string, string, string, int32, any) error
	Recover(context.Context, int32) ([]Job, error)
	PendingBilling(context.Context, int32) ([]Job, error)
}

type InputReader interface {
	Read(context.Context, string, string) (Input, error)
}

type OutputStore interface {
	Save(context.Context, string, int32, Image) (SavedOutput, error)
	List(context.Context, string) ([]SavedOutput, error)
}

type Billing interface {
	Begin(context.Context, billing.Request) (billing.Reservation, error)
	Start(context.Context, string) error
	Finish(context.Context, string, billing.Usage) error
	ImageCharge(context.Context, string, string) (billing.Amount, error)
}

type Service struct {
	models    ModelReader
	jobs      Jobs
	inputs    InputReader
	outputs   OutputStore
	billing   Billing
	providers map[model.Provider]Adapter
	slots     chan struct{}
	active    sync.WaitGroup
	polling   sync.Mutex
}

func NewService(models ModelReader, jobs Jobs, inputs InputReader, outputs OutputStore, charges Billing) *Service {
	return &Service{models: models, jobs: jobs, inputs: inputs, outputs: outputs,
		billing: charges, providers: make(map[model.Provider]Adapter), slots: make(chan struct{}, 4)}
}

func (s *Service) WithAdapter(provider model.Provider, adapter Adapter) *Service {
	s.providers[provider] = adapter
	return s
}

func (s *Service) Capabilities(provider model.Provider, modelID string) (model.ImageCapabilities, error) {
	adapter, ok := s.providers[provider]
	if !ok || adapter.Capabilities == nil {
		return model.ImageCapabilities{}, resource.Invalid("生图供应商未配置")
	}
	var cap Capabilities
	if strings.TrimSpace(modelID) == "" {
		if adapter.DefaultCapabilities == nil {
			return model.ImageCapabilities{}, resource.Invalid("生图供应商默认能力未配置")
		}
		cap = adapter.DefaultCapabilities()
	} else {
		var err error
		cap, err = adapter.Capabilities(strings.TrimSpace(modelID))
		if err != nil {
			return model.ImageCapabilities{}, err
		}
	}
	operations := make([]string, 0, len(cap.Operations))
	for _, operation := range cap.Operations {
		if operation == "generate" && adapter.Generator != nil || operation == "edit" && adapter.Editor != nil {
			operations = append(operations, operation)
		}
	}
	return model.ImageCapabilities{
		Operations: operations, Qualities: cap.Qualities, AspectRatios: cap.AspectRatios,
		AllowedAspectRatios: cap.AllowedRatios, MaxImages: cap.MaxCount,
		MaxReferenceImages: cap.MaxReferences, SupportsReference: cap.SupportsReference,
		SupportsMask: cap.SupportsMask,
	}, nil
}

func (s *Service) Generate(ctx context.Context, target proxy.Target, input imageproxy.GenerateRequest) (imageproxy.Task, error) {
	return s.submit(ctx, target, "generate", input.Model, input.Prompt, input.Quality,
		input.AspectRatio, input.Count, input.IdempotencyKey, input.ReferenceImages, nil)
}

func (s *Service) Edit(ctx context.Context, target proxy.Target, input imageproxy.EditRequest) (imageproxy.Task, error) {
	return s.submit(ctx, target, "edit", input.Model, input.Prompt, input.Quality,
		input.AspectRatio, input.Count, input.IdempotencyKey, input.Images, input.Mask)
}

func (s *Service) submit(ctx context.Context, target proxy.Target, operation, requestedModel, prompt, quality, aspect string,
	count *uint32, idempotency string, references []imageproxy.Reference, mask *imageproxy.Reference) (imageproxy.Task, error) {
	select {
	case s.slots <- struct{}{}:
	default:
		return imageproxy.Task{}, &resource.Error{Status: 429, Code: "image_concurrency_limit", Message: "生图任务繁忙，请稍后重试"}
	}
	held := true
	defer func() {
		if held {
			<-s.slots
		}
	}()
	item, err := s.models.Get(ctx, target.ModelID)
	if err != nil {
		return imageproxy.Task{}, err
	}
	if item.Kind != model.KindImage || item.ImageConfig == nil || item.ImagePricing == nil ||
		item.ModelID != target.UpstreamModel || item.Protocol != model.ProtocolImage {
		return imageproxy.Task{}, resource.Invalid("模型不支持生图")
	}
	adapter, ok := s.providers[item.Provider]
	if !ok || adapter.Capabilities == nil {
		return imageproxy.Task{}, resource.Invalid("生图适配器未配置")
	}
	cap, err := adapter.Capabilities(item.ModelID)
	if err != nil {
		return imageproxy.Task{}, err
	}
	if (operation == "generate" && (adapter.Generator == nil || !slices.Contains(cap.Operations, "generate"))) ||
		(operation == "edit" && (adapter.Editor == nil || !slices.Contains(cap.Operations, "edit"))) {
		return imageproxy.Task{}, resource.Invalid("模型不支持此生图操作")
	}
	if quality == "" {
		quality = item.ImageConfig.DefaultQuality
	}
	if aspect == "" {
		aspect = item.ImageConfig.DefaultAspectRatio
	}
	if !slices.Contains(cap.Qualities, quality) || !slices.Contains(cap.AspectRatios, aspect) ||
		(cap.AllowedRatios != nil && !slices.Contains(cap.AllowedRatios[quality], aspect)) {
		return imageproxy.Task{}, resource.Invalid("模型不支持此画质与比例组合")
	}
	imageCount := uint32(1)
	if count != nil {
		imageCount = *count
	}
	if imageCount == 0 || imageCount > 16 || imageCount > cap.MaxCount {
		return imageproxy.Task{}, resource.Invalid("生图数量超出模型上限")
	}
	if operation == "edit" && len(references) == 0 || len(references) > cap.MaxReferences ||
		(operation == "generate" && len(references) > 0 && !cap.SupportsReference) ||
		(mask != nil && (!cap.SupportsMask || operation != "edit")) {
		return imageproxy.Task{}, resource.Invalid("参考图或编辑参数不受支持")
	}
	var unit billing.Amount
	if item.OwnershipType != "user" {
		unit, err = Quote(item, operation, quality, aspect)
		if err != nil {
			return imageproxy.Task{}, resource.Invalid(err.Error())
		}
	}
	images := make([]Input, 0, len(references))
	fileIDs := make([]string, 0, len(references)+1)
	digests := make([]string, 0, len(references)+1)
	for _, ref := range references {
		image, err := s.inputs.Read(ctx, target.UserID, ref.FileID)
		if err != nil {
			return imageproxy.Task{}, err
		}
		digest := sha256.Sum256(image.Data)
		digests = append(digests, hex.EncodeToString(digest[:]))
		fileIDs = append(fileIDs, ref.FileID)
		images = append(images, image)
	}
	var maskInput *Input
	if mask != nil {
		image, err := s.inputs.Read(ctx, target.UserID, mask.FileID)
		if err != nil {
			return imageproxy.Task{}, err
		}
		digest := sha256.Sum256(image.Data)
		digests = append(digests, hex.EncodeToString(digest[:]))
		fileIDs = append(fileIDs, mask.FileID)
		maskInput = &image
	}
	body, err := json.Marshal(struct {
		Model, Operation, Prompt, Quality, Aspect string
		Count                                     uint32
		Inputs                                    []string
	}{requestedModel, operation, prompt, quality, aspect, imageCount, digests})
	if err != nil {
		return imageproxy.Task{}, err
	}
	hash := sha256.Sum256(body)
	config, err := json.Marshal(map[string]any{"file_ids": fileIDs})
	if err != nil {
		return imageproxy.Task{}, err
	}
	pricing, err := json.Marshal(map[string]string{"unit": unit.String()})
	if err != nil {
		return imageproxy.Task{}, err
	}
	job, created, err := s.jobs.Create(ctx, Job{
		UserID: target.UserID, ModelID: item.ID, Provider: string(item.Provider), Operation: operation,
		RequestHash: hex.EncodeToString(hash[:]), IdempotencyKey: idempotency, RequestedImages: int32(imageCount),
		Quality: quality, AspectRatio: aspect, RequestConfig: config, PricingSnapshot: pricing,
	})
	if err != nil {
		return imageproxy.Task{}, err
	}
	if !created {
		return s.Get(ctx, target.UserID, job.ID)
	}
	if err := s.jobs.LinkInputs(ctx, job.ID, fileIDs); err != nil {
		s.failUnsubmitted(ctx, job, "invalid_reference")
		return imageproxy.Task{}, err
	}
	var reservationID string
	if item.OwnershipType != "user" {
		reservation, err := s.billing.Begin(ctx, billing.Request{
			UserID: target.UserID, ResourceID: item.ID, Category: "image", ImageCount: int64(imageCount),
			ImageUnitPrice: unit, IdempotencyKey: job.ID, RequestHash: job.RequestHash,
		})
		if err != nil {
			s.failUnsubmitted(ctx, job, "billing_failed")
			return imageproxy.Task{}, err
		}
		reservationID = reservation.ID
		job.BillingTransactionID = &reservationID
	}
	if err := s.jobs.Reserve(ctx, job, reservationID); err != nil {
		s.failUnsubmitted(ctx, job, "reservation_failed")
		return imageproxy.Task{}, err
	}
	if reservationID != "" {
		if err := s.billing.Start(ctx, reservationID); err != nil {
			s.failUnsubmitted(ctx, job, "billing_start_failed")
			return imageproxy.Task{}, err
		}
	}
	if err := s.jobs.Submitted(ctx, job.ID); err != nil {
		s.failUnsubmitted(ctx, job, "submit_failed")
		return imageproxy.Task{}, err
	}
	held = false
	s.active.Go(func() {
		defer func() { <-s.slots }()
		callCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Minute)
		defer cancel()
		request := ProviderRequest{Prompt: prompt, Quality: quality, AspectRatio: aspect, Count: imageCount, Images: images, Mask: maskInput}
		var result ProviderResult
		var err error
		if operation == "generate" {
			result, err = adapter.Generator.Generate(callCtx, target, request)
		} else {
			result, err = adapter.Editor.Edit(callCtx, target, request)
		}
		s.handleResult(callCtx, job, result, err)
	})
	return imageproxy.Task{ID: job.ID, UserID: job.UserID, Operation: operation, Status: "pending",
		Usage: &imageproxy.Usage{RequestedImages: imageCount}}, nil
}

func (s *Service) failUnsubmitted(ctx context.Context, job Job, code string) {
	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	if err := s.jobs.Finish(finishCtx, job.ID, "failed", code, 0, map[string]any{}); err != nil {
		slog.Error("生图任务预留失败后的状态写入失败", "job", job.ID, "error", err)
	}
	if job.BillingTransactionID != nil {
		if err := s.billing.Finish(finishCtx, *job.BillingTransactionID, billing.Usage{Known: true, Result: "failed", ErrorCode: code}); err != nil {
			slog.Error("生图任务预留失败后释放积分失败", "job", job.ID, "error", err)
		}
	}
}

func providerErrorType(err error) string {
	if _, ok := errors.AsType[*url.Error](err); ok {
		return "url_error"
	}
	return fmt.Sprintf("%T", err)
}

func (s *Service) handleResult(ctx context.Context, job Job, result ProviderResult, err error) {
	if err != nil {
		if ctx.Err() == nil {
			slog.Warn("生图上游请求失败，任务状态待确认", "job", job.ID, "operation", job.Operation, "error_type", providerErrorType(err))
		}
		s.markUnknown(ctx, job, "provider_status_unknown")
		return
	}
	switch result.Status {
	case "pending", "running":
		if result.ID == "" {
			s.markUnknown(ctx, job, "provider_job_id_missing")
		} else if err := s.jobs.Running(ctx, job.ID, result.ID); err != nil {
			slog.Error("记录生图任务运行状态失败", "job", job.ID, "operation", "running", "error", err)
			s.markUnknown(ctx, job, "provider_job_id_missing")
		}
	case "failed":
		s.finish(ctx, job, "failed", result.ErrorCode, nil, result.RequestID)
	case "succeeded":
		s.finish(ctx, job, "succeeded", "", result.Images, result.RequestID)
	default:
		s.markUnknown(ctx, job, "provider_status_unknown")
	}
}

func (s *Service) finish(ctx context.Context, job Job, status, code string, images []Image, requestID string) {
	if status == "succeeded" {
		if len(images) == 0 || len(images) > int(job.RequestedImages) {
			s.markUnknown(ctx, job, "provider_output_invalid")
			return
		}
		for i, image := range images {
			if _, err := s.outputs.Save(ctx, job.ID, int32(i), image); err != nil {
				slog.Error("生图结果归档失败", "job", job.ID, "error", err)
				s.markUnknown(ctx, job, "image_archive_failed")
				return
			}
		}
	}
	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	if err := s.jobs.Finish(finishCtx, job.ID, status, code, int32(len(images)), map[string]any{"generated_images": len(images)}); err != nil {
		slog.Error("生图任务结算状态写入失败", "job", job.ID, "error", err)
		return
	}
	if job.BillingTransactionID != nil {
		if err := s.billing.Finish(finishCtx, *job.BillingTransactionID,
			billing.Usage{Known: true, Result: status, Images: int64(len(images)), ErrorCode: code, RequestID: requestID}); err != nil {
			slog.Error("生图积分结算失败，等待恢复", "job", job.ID, "error", err)
		}
	}
}

func (s *Service) markUnknown(ctx context.Context, job Job, code string) {
	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	if err := s.jobs.Unknown(finishCtx, job.ID, code); err != nil {
		slog.Error("生图任务未知状态写入失败", "job", job.ID, "error", err)
	}
	if job.BillingTransactionID != nil {
		if err := s.billing.Finish(finishCtx, *job.BillingTransactionID,
			billing.Usage{Known: false, Result: "failed", ErrorCode: code}); err != nil {
			slog.Error("生图未知状态计费记录失败", "job", job.ID, "error", err)
		}
	}
}

func (s *Service) Get(ctx context.Context, userID, jobID string) (imageproxy.Task, error) {
	job, err := s.jobs.Get(ctx, userID, jobID)
	if err != nil {
		return imageproxy.Task{}, err
	}
	status := job.Status
	if status == "created" || status == "reserved" || status == "submitted" {
		status = "pending"
	}
	results, err := s.outputs.List(ctx, job.ID)
	if err != nil {
		return imageproxy.Task{}, err
	}
	outputs := make([]imageproxy.Output, 0, len(results))
	for _, result := range results {
		if result.PurgedAt != nil || !result.ExpiresAt.After(time.Now()) {
			continue
		}
		outputs = append(outputs, imageproxy.Output{URL: "/v1/images/outputs/" + result.ID,
			MIMEType: result.MIMEType, Width: uint32(result.Width), Height: uint32(result.Height)})
	}
	if status == "succeeded" && len(results) > 0 && len(outputs) == 0 {
		status = "expired"
	}
	usage := &imageproxy.Usage{RequestedImages: uint32(job.RequestedImages), GeneratedImages: uint32(job.GeneratedImages)}
	if job.BillingTransactionID != nil && (status == "succeeded" || status == "failed" || status == "expired") {
		if amount, err := s.billing.ImageCharge(ctx, *job.BillingTransactionID, userID); err == nil {
			usage.Credits = amount.String()
		} else if ctx.Err() == nil {
			slog.Warn("读取生图积分用量失败", "job", job.ID, "operation", "image_charge", "error", err)
		}
	}
	return imageproxy.Task{ID: job.ID, UserID: job.UserID, Operation: job.Operation, Status: status,
		Outputs: outputs, Usage: usage}, nil
}

func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	s.recover(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.recover(ctx)
		}
	}
}

func (s *Service) recover(ctx context.Context) {
	if !s.polling.TryLock() {
		return
	}
	defer s.polling.Unlock()
	jobs, err := s.jobs.Recover(ctx, 50)
	if err != nil {
		slog.Error("加载待恢复生图任务失败", "error", err)
		return
	}
	for _, job := range jobs {
		switch job.Status {
		case "reserved":
			s.failUnsubmitted(ctx, job, "submission_not_started")
		case "submitted":
			s.markUnknown(ctx, job, "submission_status_unknown")
		case "running", "unknown":
			if job.ProviderJobID == nil {
				continue
			}
			item, err := s.models.Get(ctx, job.ModelID)
			if err != nil {
				if ctx.Err() == nil {
					slog.Warn("加载待恢复生图模型失败", "job", job.ID, "operation", "recover_model", "error", err)
				}
				continue
			}
			adapter := s.providers[item.Provider]
			if adapter.TaskQuerier == nil {
				continue
			}
			target := proxy.Target{ModelID: item.ID, UserID: job.UserID, UpstreamModel: item.ModelID,
				BaseURL: item.BaseURL, APIKey: item.APIKey, Protocol: string(item.Protocol)}
			callCtx, cancel := context.WithTimeout(ctx, time.Minute)
			result, err := adapter.TaskQuerier.QueryTask(callCtx, target, *job.ProviderJobID)
			if err != nil {
				if ctx.Err() == nil {
					slog.Warn("查询待恢复生图任务失败", "job", job.ID, "operation", "query_task", "error_type", providerErrorType(err))
				}
			} else if result.Status != "running" && result.Status != "pending" {
				s.handleResult(callCtx, job, result, nil)
			}
			cancel()
		}
	}
	pending, err := s.jobs.PendingBilling(ctx, 50)
	if err != nil {
		slog.Error("加载待结算生图任务失败", "error", err)
		return
	}
	for _, job := range pending {
		if job.BillingTransactionID == nil {
			continue
		}
		u := billing.Usage{Known: true, Result: job.Status, Images: int64(job.GeneratedImages)}
		if err := s.billing.Finish(ctx, *job.BillingTransactionID, u); err != nil {
			slog.Error("恢复生图积分结算失败", "job", job.ID, "error", err)
		}
	}
}

func (s *Service) Wait(ctx context.Context) error {
	finished := make(chan struct{})
	go func() { s.active.Wait(); close(finished) }()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-finished:
		return nil
	}
}

var _ imageproxy.Generator = (*Service)(nil)
var _ imageproxy.Editor = (*Service)(nil)
var _ imageproxy.TaskQuerier = (*Service)(nil)
