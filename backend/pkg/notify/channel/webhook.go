package channel

import (
	"context"
	"fmt"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

type WebhookSender struct{}

func NewWebhookSender() *WebhookSender { return &WebhookSender{} }

func (w *WebhookSender) Kind() consts.NotifyChannelKind { return consts.NotifyChannelWebhook }

func (w *WebhookSender) Send(ctx context.Context, cfg *ChannelConfig, msg Message) error {
	body := map[string]any{
		"title": msg.Title,
		"body":  msg.Body,
	}
	var opts []request.Opt
	if len(cfg.Headers) > 0 {
		opts = append(opts, request.WithHeader(cfg.Headers))
	}
	resp, err := request.PostURL[apiResponse](ctx, cfg.WebhookURL, body, opts...)
	if err != nil {
		return err
	}
	if resp.ErrCode != 0 {
		return fmt.Errorf("webhook api error: errcode=%d, errmsg=%s", resp.ErrCode, resp.ErrMsg)
	}
	return nil
}
