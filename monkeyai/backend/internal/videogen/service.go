package videogen

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/videogen/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ModelReader interface {
	Get(context.Context, string) (model.Model, error)
}

type Service struct {
	pool    *pgxpool.Pool
	storage resource.Storage
	billing *billing.Service
	models  ModelReader
	client  *http.Client
	jobs    sync.WaitGroup
}

func NewService(pool *pgxpool.Pool, storage resource.Storage, bills *billing.Service, models ModelReader) *Service {
	return &Service{pool: pool, storage: storage, billing: bills, models: models, client: providerClient()}
}

type pricingSnapshot struct {
	Resolution       string `json:"resolution"`
	CreditsPerSecond string `json:"credits_per_second"`
	ReservedCredits  string `json:"reserved_credits"`
	MaxDurationMs    int64  `json:"max_duration_ms"`
}

type Task struct {
	ID      string          `json:"id"`
	Model   string          `json:"model"`
	Mode    model.VideoMode `json:"mode"`
	Status  string          `json:"status"`
	Pricing *struct {
		ReservedCredits string `json:"reserved_credits"`
	} `json:"pricing,omitempty"`
	Output *VideoOutput `json:"output,omitempty"`
	Usage  *struct {
		Resolution       string `json:"resolution"`
		OutputDurationMs int64  `json:"output_duration_ms"`
		Credits          string `json:"credits"`
	} `json:"usage,omitempty"`
	ErrorCode   string     `json:"error_code,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

func (s *Service) Submit(ctx context.Context, target proxy.Target, input GenerateInput, key string) (Task, error) {
	if target.UserID == "" || target.Protocol != string(model.ProtocolVideo) || target.ModelID == "" ||
		key != "" && len(key) > 128 {
		return Task{}, resource.Invalid("视频凭据、模型或幂等键无效")
	}
	item, err := s.models.Get(ctx, target.ModelID)
	if err != nil {
		return Task{}, err
	}
	if item.Kind != model.KindVideo || item.VideoConfig == nil || item.VideoPricing == nil || item.ModelID != target.UpstreamModel {
		return Task{}, resource.Invalid("视频模型配置无效")
	}
	cap, err := model.VideoCapabilitiesFor(item.Provider, item.ModelID)
	if err != nil || model.ValidateVideoCapabilities(item, cap) != nil {
		return Task{}, resource.Invalid("视频模型能力不可用")
	}
	values, err := model.NormalizeVideoParams(item.VideoConfig, cap, input.Mode, input.Params)
	if err != nil {
		return Task{}, resource.Invalid(err.Error())
	}
	input.Params = values
	input.Prompt = strings.TrimSpace(input.Prompt)
	if len([]rune(input.Prompt)) > int(cap.PromptMaxCharacters) || model.VideoPromptRequired(cap, input.Mode, values) && input.Prompt == "" {
		return Task{}, resource.Invalid("视频提示词无效")
	}
	if _, err := model.VideoDuration(values); err != nil {
		return Task{}, resource.Invalid(err.Error())
	}
	if err := validateReferences(input.Mode, input.References, cap); err != nil {
		return Task{}, err
	}
	loaded := make([]Reference, 0, len(input.References))
	totalBytes := 0
	for _, ref := range input.References {
		for _, spec := range cap.References {
			if spec.Role == ref.Role {
				value, err := s.loadInput(ctx, target.UserID, ref, spec)
				if err != nil {
					return Task{}, err
				}
				totalBytes += len(value.Data)
				if totalBytes > 24<<20 {
					return Task{}, resource.Invalid("视频参考图总大小超过 24 MiB")
				}
				loaded = append(loaded, value)
				break
			}
		}
	}
	resolution := model.VideoResolution(values)
	rate, err := model.VideoRateFor(item.VideoPricing, resolution)
	if err != nil {
		return Task{}, resource.Invalid(err.Error())
	}
	maxMs := int64(15_000)
	reserve, err := billing.QuoteVideo(rate, maxMs)
	if err != nil {
		return Task{}, resource.Invalid(err.Error())
	}
	if item.OwnershipType == "user" {
		reserve = 0
	}
	price := pricingSnapshot{Resolution: resolution, CreditsPerSecond: rate.String(), ReservedCredits: reserve.String(), MaxDurationMs: maxMs}
	input.Model = item.ModelID + "@" + item.ID
	canonical, err := json.Marshal(struct {
		GenerateInput
		SessionID string `json:"session_id"`
	}{input, target.SessionID})
	if err != nil {
		return Task{}, err
	}
	hash := sha256.Sum256(canonical)
	requestHash := hex.EncodeToString(hash[:])
	if key != "" {
		existing, err := s.idempotent(ctx, target.UserID, key, requestHash)
		if err != nil {
			return Task{}, err
		}
		if existing != "" {
			return s.GetTask(ctx, target.UserID, existing)
		}
	}
	reservation, err := s.billing.Begin(ctx, billing.Request{
		UserID: target.UserID, ResourceID: item.ID, SessionID: target.SessionID,
		Category: "video", VideoUnitPrice: rate, VideoMaxDurationMs: maxMs,
		IdempotencyKey: key, RequestHash: requestHash,
	})
	if err != nil {
		if key != "" {
			if existing, _ := s.idempotent(ctx, target.UserID, key, requestHash); existing != "" {
				return s.GetTask(ctx, target.UserID, existing)
			}
		}
		return Task{}, err
	}
	jobID := resource.ID()
	priceJSON, _ := json.Marshal(price)
	err = sqlc.New(s.pool).InsertVideoJob(ctx, sqlc.InsertVideoJobParams{
		ID: jobID, UserID: target.UserID, ModelID: item.ID, SessionID: target.SessionID,
		Provider: string(item.Provider), Mode: string(input.Mode), RequestHash: requestHash,
		IdempotencyKey: key, RequestConfig: canonical, PricingSnapshot: priceJSON,
		BillingTransactionID: reservation.ID,
	})
	if err != nil {
		_ = s.billing.Release(context.WithoutCancel(ctx), reservation.ID, "task_create_failed")
		return Task{}, err
	}
	for ordinal, ref := range loaded {
		if err = sqlc.New(s.pool).InsertVideoJobInput(ctx, sqlc.InsertVideoJobInputParams{
			JobID: jobID, InputID: ref.FileID, Ordinal: int32(ordinal), Role: ref.Role,
		}); err != nil {
			s.fail(context.WithoutCancel(ctx), jobID, reservation.ID, "input_record_failed")
			return Task{}, err
		}
	}
	s.jobs.Add(1)
	go func() {
		defer s.jobs.Done()
		s.dispatch(context.WithoutCancel(ctx), target, jobID, reservation.ID, inputWithData(input, loaded))
	}()
	return s.GetTask(ctx, target.UserID, jobID)
}

func inputWithData(input GenerateInput, loaded []Reference) GenerateInput {
	input.References = loaded
	return input
}

func validateReferences(mode model.VideoMode, refs []Reference, cap model.VideoCapabilities) error {
	var rule *model.VideoModeReferences
	for index := range cap.ReferenceModes {
		if cap.ReferenceModes[index].Mode == mode {
			rule = &cap.ReferenceModes[index]
			break
		}
	}
	if rule == nil {
		return resource.Invalid("参考图模式不受支持")
	}
	counts := make(map[string]int)
	for _, ref := range refs {
		if !stringIn(rule.RequiredRoles, ref.Role) && !stringIn(rule.OptionalRoles, ref.Role) {
			return resource.Invalid("参考图角色不属于当前模式")
		}
		counts[ref.Role]++
	}
	for _, role := range rule.RequiredRoles {
		if counts[role] == 0 {
			return resource.Invalid("缺少必需的参考图")
		}
	}
	for _, spec := range cap.References {
		if counts[spec.Role] > int(spec.MaxCount) {
			return resource.Invalid("参考图数量超出模型限制")
		}
	}
	return nil
}

func (s *Service) idempotent(ctx context.Context, userID, key, hash string) (string, error) {
	row, err := sqlc.New(s.pool).IdempotentVideoJob(ctx, sqlc.IdempotentVideoJobParams{UserID: userID, IdempotencyKey: &key})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if hash != row.RequestHash {
		return "", &resource.Error{Status: 409, Code: "idempotency_conflict", Message: "幂等键对应不同的视频请求"}
	}
	return row.ID, nil
}

func (s *Service) GetTask(ctx context.Context, userID, id string) (Task, error) {
	if !fileIDPattern.MatchString(id) {
		return Task{}, resource.NotFound
	}
	row, err := sqlc.New(s.pool).VideoTaskOwned(ctx, sqlc.VideoTaskOwnedParams{ID: id, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Task{}, resource.NotFound
	}
	if err != nil {
		return Task{}, err
	}
	task := Task{ID: id, Mode: model.VideoMode(row.Mode), Status: row.Status,
		CreatedAt: row.CreatedAt, CompletedAt: row.CompletedAt}
	var input GenerateInput
	var price pricingSnapshot
	if json.Unmarshal(row.RequestConfig, &input) != nil || json.Unmarshal(row.PricingSnapshot, &price) != nil {
		return Task{}, errors.New("视频任务快照无效")
	}
	task.Model = input.Model
	if row.ErrorCode != nil {
		task.ErrorCode = *row.ErrorCode
	}
	if task.Status == "created" || task.Status == "reserved" || task.Status == "submitted" {
		task.Status = "pending"
	}
	if task.Status == "pending" || task.Status == "running" || task.Status == "unknown" {
		task.Pricing = &struct {
			ReservedCredits string `json:"reserved_credits"`
		}{price.ReservedCredits}
	}
	if row.OutputID != nil && row.ExpiresAt != nil && time.Now().After(*row.ExpiresAt) && task.Status == "succeeded" {
		task.Status = "expired"
	}
	if row.OutputID != nil && task.Status == "succeeded" {
		task.Output = &VideoOutput{FileID: *row.OutputID, URL: "/v1/videos/outputs/" + *row.OutputID, MIMEType: *row.MimeType,
			Width: int(*row.Width), Height: int(*row.Height), DurationMs: *row.DurationMs, ByteSize: *row.ByteSize}
	}
	if row.DurationMs != nil && (task.Status == "succeeded" || task.Status == "expired") {
		credit := "0"
		if row.BillingTransactionID != nil {
			amount, err := s.billing.VideoCharge(ctx, *row.BillingTransactionID, userID)
			if err != nil {
				return Task{}, err
			}
			credit = amount.String()
		}
		task.Usage = &struct {
			Resolution       string `json:"resolution"`
			OutputDurationMs int64  `json:"output_duration_ms"`
			Credits          string `json:"credits"`
		}{price.Resolution, *row.DurationMs, credit}
	}
	return task, nil
}

func (s *Service) fail(ctx context.Context, id, transactionID, reason string) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	if err := s.billing.Release(ctx, transactionID, reason); err != nil {
		slog.ErrorContext(ctx, "释放视频计费预留失败", "job_id", id, "error", err)
		code := "billing_unknown"
		_ = sqlc.New(s.pool).MarkVideoJobUnknown(ctx, sqlc.MarkVideoJobUnknownParams{ID: id, ErrorCode: &code})
		return
	}
	_ = sqlc.New(s.pool).MarkVideoJobFailed(ctx, sqlc.MarkVideoJobFailedParams{ID: id, ErrorCode: &reason})
}

func (s *Service) dispatch(ctx context.Context, target proxy.Target, jobID, reservationID string, input GenerateInput) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	if err := s.billing.Start(ctx, reservationID); err != nil {
		s.fail(ctx, jobID, reservationID, "billing_start_failed")
		return
	}
	providerID, err := submitProvider(ctx, s.client, target, input)
	if err != nil {
		var rejected providerRejected
		if errors.As(err, &rejected) {
			s.fail(ctx, jobID, reservationID, "provider_rejected")
			return
		}
		slog.WarnContext(ctx, "视频上游受理结果未知", "job_id", jobID, "error", err)
		code := "provider_submit_unknown"
		_ = sqlc.New(s.pool).MarkVideoJobUnknown(ctx, sqlc.MarkVideoJobUnknownParams{ID: jobID, ErrorCode: &code})
		return
	}
	if affected, e := sqlc.New(s.pool).MarkVideoJobSubmitted(ctx, sqlc.MarkVideoJobSubmittedParams{ID: jobID, ProviderJobID: &providerID}); e != nil || affected != 1 {
		err = e
		slog.ErrorContext(ctx, "登记视频上游任务失败", "job_id", jobID, "error", err)
		code := "provider_job_unknown"
		_ = sqlc.New(s.pool).MarkVideoJobUnknown(ctx, sqlc.MarkVideoJobUnknownParams{ID: jobID, ErrorCode: &code})
	}
}

func (s *Service) Wait(ctx context.Context) error {
	done := make(chan struct{})
	go func() { s.jobs.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	lastCleanup := time.Time{}
	for {
		if time.Since(lastCleanup) > time.Hour {
			if err := s.Cleanup(ctx); err != nil && ctx.Err() == nil {
				slog.ErrorContext(ctx, "清理过期视频文件失败", "error", err)
			}
			lastCleanup = time.Now()
		}
		if err := s.poll(ctx); err != nil && ctx.Err() == nil {
			slog.ErrorContext(ctx, "轮询视频任务失败", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) poll(ctx context.Context) error {
	queries := sqlc.New(s.pool)
	if err := queries.MarkAbandonedVideoJobs(ctx); err != nil {
		return err
	}
	ids, err := queries.PollableVideoJobs(ctx)
	if err != nil {
		return err
	}
	for _, id := range ids {
		claim, err := queries.ClaimVideoJobPoll(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		if claim.ProviderJobID == nil || claim.BillingTransactionID == nil {
			return errors.New("视频任务缺少供应商或计费 ID")
		}
		if err := s.process(ctx, id, claim.ModelID, *claim.ProviderJobID, *claim.BillingTransactionID, claim.UserID); err != nil {
			slog.WarnContext(ctx, "处理视频任务失败，等待重试", "job_id", id, "error", err)
			_ = queries.RetryVideoJobPoll(ctx, id)
		}
	}
	return nil
}

func (s *Service) process(ctx context.Context, id, modelID, providerID, transactionID, userID string) error {
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	item, err := s.models.Get(ctx, modelID)
	if err != nil {
		return err
	}
	target := proxy.Target{UpstreamModel: item.ModelID, BaseURL: item.BaseURL, APIKey: item.APIKey}
	result, err := queryProvider(ctx, s.client, target, providerID)
	if err != nil {
		return err
	}
	if result.Status == "failed" {
		s.fail(ctx, id, transactionID, "provider_failed")
		return nil
	}
	if result.Status != "succeeded" {
		return sqlc.New(s.pool).MarkVideoJobRunning(ctx, id)
	}
	duration, err := sqlc.New(s.pool).VideoJobOutputDuration(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		output, err := s.saveOutput(ctx, id, result.URL, result.DurationMs)
		if err != nil {
			return err
		}
		duration = output.DurationMs
	} else if err != nil {
		return err
	}
	if err := s.billing.Finish(ctx, transactionID, billing.Usage{Result: "succeeded", Known: true, VideoDurationMs: duration}); err != nil {
		return err
	}
	if err := s.billing.Settle(ctx, transactionID); err != nil {
		return err
	}
	if _, err := s.billing.VideoCharge(ctx, transactionID, userID); err != nil {
		return err
	}
	return sqlc.New(s.pool).MarkVideoJobSucceeded(ctx, sqlc.MarkVideoJobSucceededParams{ID: id, OutputDurationMs: &duration})
}
