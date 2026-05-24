package channel

import (
	"context"

	"fmt"

	"github.com/chaitin/MonkeyCode/backend/domain"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

type WeComSender struct{}

func NewWeComSender() *WeComSender { return &WeComSender{} }

func (w *WeComSender) Kind() consts.NotifyChannelKind { return consts.NotifyChannelWeCom }

func (w *WeComSender) Validate(cfg *ChannelConfig) error {
	return validateURLChannelCfg(cfg)
}

func (w *WeComSender) Send(ctx context.Context, cfg *ChannelConfig, _ *domain.NotifyEvent, msg Message) error {
	body := map[string]any{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"content": fmt.Sprintf("## %s\n\n%s", msg.Title, msg.Body),
		},
	}
	resp, err := request.PostURL[apiResponse](ctx, cfg.WebhookURL, body)
	if err != nil {
		return err
	}
	if resp.ErrCode != 0 {
		return fmt.Errorf("wecom api error: errcode=%d, errmsg=%s", resp.ErrCode, resp.ErrMsg)
	}
	return nil
}
