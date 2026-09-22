package imagegen

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Job struct {
	ID                   string
	UserID               string
	ModelID              string
	Provider             string
	Operation            string
	Status               string
	ProviderJobID        *string
	BillingTransactionID *string
	RequestHash          string
	IdempotencyKey       string
	RequestedImages      int32
	GeneratedImages      int32
	Quality              string
	AspectRatio          string
	RequestConfig        json.RawMessage
	PricingSnapshot      json.RawMessage
	ErrorCode            *string
	CreatedAt            time.Time
	CompletedAt          *time.Time
}

type Postgres struct{ pool *pgxpool.Pool }

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

func (p *Postgres) Create(ctx context.Context, job Job) (Job, bool, error) {
	if job.ID == "" {
		job.ID = resource.ID()
	}
	if job.IdempotencyKey != "" && len(job.IdempotencyKey) > 128 {
		return Job{}, false, resource.Invalid("幂等键过长")
	}
	if job.UserID == "" || job.ModelID == "" || job.RequestHash == "" || job.RequestedImages < 1 {
		return Job{}, false, resource.Invalid("生图任务参数无效")
	}
	if len(job.RequestConfig) == 0 {
		job.RequestConfig = json.RawMessage(`{}`)
	}
	if len(job.PricingSnapshot) == 0 {
		job.PricingSnapshot = json.RawMessage(`{}`)
	}
	var key *string
	if job.IdempotencyKey != "" {
		key = &job.IdempotencyKey
	}
	_, err := sqlc.New(p.pool).InsertJob(ctx, sqlc.InsertJobParams{
		ID: job.ID, UserID: job.UserID, ModelID: job.ModelID,
		Provider: job.Provider, Operation: job.Operation, RequestHash: job.RequestHash,
		IdempotencyKey: key, RequestedImages: job.RequestedImages,
		Quality: job.Quality, AspectRatio: job.AspectRatio,
		RequestConfig: job.RequestConfig, PricingSnapshot: job.PricingSnapshot,
	})
	if err == nil {
		job.Status = "created"
		return job, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) || key == nil {
		return Job{}, false, err
	}
	existing, err := sqlc.New(p.pool).JobByIdempotency(ctx, sqlc.JobByIdempotencyParams{
		UserID: job.UserID, IdempotencyKey: key,
	})
	if err != nil {
		return Job{}, false, err
	}
	if existing.RequestHash != job.RequestHash {
		return Job{}, false, &resource.Error{Status: 409, Code: "idempotency_conflict", Message: "幂等键已用于其他生图请求"}
	}
	stored, err := p.Get(ctx, job.UserID, existing.ID)
	return stored, false, err
}

func (p *Postgres) LinkInputs(ctx context.Context, jobID string, fileIDs []string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for _, fileID := range fileIDs {
		if _, err := sqlc.New(tx).LinkJobInput(ctx, sqlc.LinkJobInputParams{JobID: jobID, InputID: fileID}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return resource.Invalid("参考图无效、过期或重复")
			}
			return err
		}
	}
	return tx.Commit(ctx)
}

func (p *Postgres) Get(ctx context.Context, userID, id string) (Job, error) {
	row, err := sqlc.New(p.pool).JobByOwner(ctx, sqlc.JobByOwnerParams{ID: id, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return Job{}, resource.NotFound
	}
	if err != nil {
		return Job{}, err
	}
	return Job{
		ID: row.ID, UserID: row.UserID, ModelID: row.ModelID,
		Provider: row.Provider, Operation: row.Operation, Status: row.Status,
		ProviderJobID: row.ProviderJobID, BillingTransactionID: row.BillingTransactionID,
		RequestedImages: row.RequestedImages, GeneratedImages: row.GeneratedImages,
		Quality: row.Quality, AspectRatio: row.AspectRatio, ErrorCode: row.ErrorCode,
		CreatedAt: row.CreatedAt, CompletedAt: row.CompletedAt,
		PricingSnapshot: row.PricingSnapshot,
	}, nil
}

func (p *Postgres) Reserve(ctx context.Context, job Job, transactionID string) error {
	count, err := sqlc.New(p.pool).SetJobReservation(ctx, sqlc.SetJobReservationParams{
		ID: job.ID, UserID: job.UserID, BillingTransactionID: &transactionID,
	})
	return one(count, err)
}

func (p *Postgres) Submitted(ctx context.Context, id string) error {
	count, err := sqlc.New(p.pool).SetJobSubmitted(ctx, id)
	return one(count, err)
}

func (p *Postgres) Running(ctx context.Context, id, providerJobID string) error {
	count, err := sqlc.New(p.pool).SetJobProviderID(ctx, sqlc.SetJobProviderIDParams{ID: id, ProviderJobID: &providerJobID})
	return one(count, err)
}

func (p *Postgres) Unknown(ctx context.Context, id, code string) error {
	count, err := sqlc.New(p.pool).SetJobUnknown(ctx, sqlc.SetJobUnknownParams{ID: id, ErrorCode: &code})
	return one(count, err)
}

func (p *Postgres) Finish(ctx context.Context, id, status, code string, generated int32, usage any) error {
	if status != "succeeded" && status != "failed" {
		return resource.Invalid("任务结果无效")
	}
	if generated < 0 {
		return resource.Invalid("生成数量无效")
	}
	data, err := json.Marshal(usage)
	if err != nil {
		return err
	}
	if string(data) == "null" {
		data = []byte(`{}`)
	}
	count, err := sqlc.New(p.pool).SetJobFinished(ctx, sqlc.SetJobFinishedParams{
		ID: id, Status: status, GeneratedImages: generated, ErrorCode: &code, Usage: data,
	})
	return one(count, err)
}

func (p *Postgres) Recover(ctx context.Context, limit int32) ([]Job, error) {
	if limit < 1 || limit > 100 {
		return nil, resource.Invalid("任务恢复数量无效")
	}
	rows, err := sqlc.New(p.pool).JobsToRecover(ctx, limit)
	if err != nil {
		return nil, err
	}
	jobs := make([]Job, 0, len(rows))
	for _, row := range rows {
		jobs = append(jobs, Job{
			ID: row.ID, UserID: row.UserID, ModelID: row.ModelID,
			Provider: row.Provider, Operation: row.Operation, Status: row.Status,
			ProviderJobID: row.ProviderJobID, BillingTransactionID: row.BillingTransactionID,
			RequestedImages: row.RequestedImages, GeneratedImages: row.GeneratedImages,
			Quality: row.Quality, AspectRatio: row.AspectRatio,
			ErrorCode: row.ErrorCode, CreatedAt: row.CreatedAt, CompletedAt: row.CompletedAt,
			PricingSnapshot: row.PricingSnapshot,
		})
	}
	return jobs, nil
}

func (p *Postgres) PendingBilling(ctx context.Context, limit int32) ([]Job, error) {
	if limit < 1 || limit > 100 {
		return nil, resource.Invalid("结算恢复数量无效")
	}
	rows, err := sqlc.New(p.pool).JobsWithPendingBilling(ctx, limit)
	if err != nil {
		return nil, err
	}
	jobs := make([]Job, 0, len(rows))
	for _, row := range rows {
		jobs = append(jobs, Job{
			ID: row.ID, UserID: row.UserID, ModelID: row.ModelID,
			Provider: row.Provider, Operation: row.Operation, Status: row.Status,
			ProviderJobID: row.ProviderJobID, BillingTransactionID: row.BillingTransactionID,
			RequestedImages: row.RequestedImages, GeneratedImages: row.GeneratedImages,
			Quality: row.Quality, AspectRatio: row.AspectRatio,
			ErrorCode: row.ErrorCode, CreatedAt: row.CreatedAt, CompletedAt: row.CompletedAt,
			PricingSnapshot: row.PricingSnapshot,
		})
	}
	return jobs, nil
}

func one(count int64, err error) error {
	if err != nil {
		return err
	}
	if count != 1 {
		return fmt.Errorf("生图任务状态未更新: %d", count)
	}
	return nil
}
