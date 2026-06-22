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
	// HandleTextMessage 处理用户文本消息：后台查知识库，同步窗口内拿到答案就返回（被动回复），
	// 否则返回占位提示并由后台用客服消息补发。返回空串表示已去重，无需回复。
	HandleTextMessage(ctx context.Context, msgID int64, mpOpenID, content string) (string, error)
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
