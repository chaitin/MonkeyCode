package repo

import (
	"context"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"

	"github.com/GoYoko/web"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/record"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

type BillingRepo struct {
	db *db.Client
}

func NewBillingRepo(db *db.Client) domain.BillingRepo {
	return &BillingRepo{db: db}
}

// ChatInfo implements domain.BillingRepo.
func (b *BillingRepo) ChatInfo(ctx context.Context, id string) (*domain.ChatInfo, error) {
	uid, err := uuid.Parse(id)
	if err != nil {
		return nil, err
	}

	record, err := b.db.Record.Query().Where(record.ID(uid)).First(ctx)
	if err != nil {
		return nil, err
	}

	return cvt.From(record, &domain.ChatInfo{}), nil
}

// CompletionInfo implements domain.BillingRepo.
func (b *BillingRepo) CompletionInfo(ctx context.Context, id string) (*domain.CompletionInfo, error) {
	uid, err := uuid.Parse(id)
	if err != nil {
		return nil, err
	}

	record, err := b.db.Record.Query().Where(record.ID(uid)).First(ctx)
	if err != nil {
		return nil, err
	}

	return cvt.From(record, &domain.CompletionInfo{}), nil
}

// ListChatRecord implements domain.BillingRepo.
func (b *BillingRepo) ListChatRecord(ctx context.Context, page *web.Pagination) (*domain.ListChatRecordResp, error) {
	q := b.db.Record.Query().
		WithUser().
		WithModel().
		Where(record.ModelType(consts.ModelTypeLLM)).
		Order(record.ByCreatedAt(sql.OrderDesc()))

	records, p, err := q.Page(ctx, page.Page, page.Size)
	if err != nil {
		return nil, err
	}

	return &domain.ListChatRecordResp{
		PageInfo: p,
		Records: cvt.Iter(records, func(_ int, r *db.Record) *domain.ChatRecord {
			return cvt.From(r, &domain.ChatRecord{})
		}),
	}, nil
}

// ListCompletionRecord implements domain.BillingRepo.
func (b *BillingRepo) ListCompletionRecord(ctx context.Context, page *web.Pagination) (*domain.ListCompletionRecordResp, error) {
	q := b.db.Record.Query().
		WithUser().
		WithModel().
		Where(record.ModelType(consts.ModelTypeCoder)).
		Order(record.ByCreatedAt(sql.OrderDesc()))
	records, p, err := q.Page(ctx, page.Page, page.Size)
	if err != nil {
		return nil, err
	}

	return &domain.ListCompletionRecordResp{
		PageInfo: p,
		Records: cvt.Iter(records, func(_ int, r *db.Record) *domain.CompletionRecord {
			return cvt.From(r, &domain.CompletionRecord{})
		}),
	}, nil
}
