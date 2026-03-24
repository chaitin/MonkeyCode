package domain

import "context"

// EmailSender 邮件发送接口
type EmailSender interface {
	SendResetPasswordEmail(ctx context.Context, to, username, resetURL string) error
	SendBindEmailVerification(ctx context.Context, to, username, verifyURL string) error
}
