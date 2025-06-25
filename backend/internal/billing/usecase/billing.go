package usecase

import (
	"context"

	"github.com/GoYoko/web"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

type BillingUsecase struct {
	repo domain.BillingRepo
}

func NewBillingUsecase(repo domain.BillingRepo) domain.BillingUsecase {
	return &BillingUsecase{repo: repo}
}

// ListChatRecord implements domain.BillingUsecase.
func (b *BillingUsecase) ListChatRecord(ctx context.Context, page *web.Pagination) (*domain.ListChatRecordResp, error) {
	return b.repo.ListChatRecord(ctx, page)
}

// ListCompletionRecord implements domain.BillingUsecase.
func (b *BillingUsecase) ListCompletionRecord(ctx context.Context, page *web.Pagination) (*domain.ListCompletionRecordResp, error) {
	return b.repo.ListCompletionRecord(ctx, page)
}

// CompletionInfo implements domain.BillingUsecase.
func (b *BillingUsecase) CompletionInfo(ctx context.Context, id string) (*domain.CompletionInfo, error) {
	return b.repo.CompletionInfo(ctx, id)
}

// ChatInfo implements domain.BillingUsecase.
func (b *BillingUsecase) ChatInfo(ctx context.Context, id string) (*domain.ChatInfo, error) {
	return b.repo.ChatInfo(ctx, id)
}
