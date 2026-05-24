package domain

import (
	"context"

	"github.com/google/uuid"
)

// WechatMPUsecase 微信公众号绑定业务接口
type WechatMPUsecase interface {
	CreateBindQRCode(ctx context.Context, userID uuid.UUID) (*BindQRCodeResp, error)
	Unbind(ctx context.Context, userID uuid.UUID) error
	HandleBindEvent(ctx context.Context, scene, mpOpenID string) (string, error)
	HandleUnsubscribe(ctx context.Context, mpOpenID string) error
}

// BindQRCodeResp 绑定二维码响应
type BindQRCodeResp struct {
	QRCodeURL string `json:"qrcode_url"`
	Ticket    string `json:"ticket"`
	ExpireSec int    `json:"expire_seconds"`
}

// TestPushReq 测试推送请求
type TestPushReq struct {
	Title   string `json:"title" validate:"required"`
	Content string `json:"content" validate:"required"`
}
