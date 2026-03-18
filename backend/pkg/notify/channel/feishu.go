package channel

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

type FeishuSender struct{}

func NewFeishuSender() *FeishuSender { return &FeishuSender{} }

func (f *FeishuSender) Kind() consts.NotifyChannelKind { return consts.NotifyChannelFeishu }

func (f *FeishuSender) Send(ctx context.Context, cfg *ChannelConfig, msg Message) error {
	body := map[string]any{
		"msg_type": "interactive",
		"card": map[string]any{
			"header": map[string]any{
				"title": map[string]string{
					"tag":     "plain_text",
					"content": msg.Title,
				},
			},
			"elements": []map[string]any{
				{"tag": "markdown", "content": msg.Body},
			},
		},
	}
	if cfg.Secret != "" {
		timestamp := fmt.Sprintf("%d", time.Now().Unix())
		stringToSign := timestamp + "\n" + cfg.Secret
		mac := hmac.New(sha256.New, []byte(stringToSign))
		sign := base64.StdEncoding.EncodeToString(mac.Sum(nil))
		body["timestamp"] = timestamp
		body["sign"] = sign
	}
	resp, err := request.PostURL[apiResponse](ctx, cfg.WebhookURL, body)
	if err != nil {
		return err
	}
	if resp.Code != 0 {
		return fmt.Errorf("feishu api error: code=%d, msg=%s", resp.Code, resp.Msg)
	}
	return nil
}
