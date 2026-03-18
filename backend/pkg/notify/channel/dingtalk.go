package channel

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/url"
	"time"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

type DingTalkSender struct{}

func NewDingTalkSender() *DingTalkSender { return &DingTalkSender{} }

func (d *DingTalkSender) Kind() consts.NotifyChannelKind { return consts.NotifyChannelDingTalk }

func (d *DingTalkSender) Send(ctx context.Context, cfg *ChannelConfig, msg Message) error {
	webhookURL := cfg.WebhookURL
	if cfg.Secret != "" {
		var err error
		webhookURL, err = dingtalkSignURL(webhookURL, cfg.Secret)
		if err != nil {
			return fmt.Errorf("sign url: %w", err)
		}
	}
	body := map[string]any{
		"msgtype": "markdown",
		"markdown": map[string]string{
			"title": msg.Title,
			"text":  msg.Body,
		},
	}
	resp, err := request.PostURL[apiResponse](ctx, webhookURL, body)
	if err != nil {
		return err
	}
	if resp.ErrCode != 0 {
		return fmt.Errorf("dingtalk api error: errcode=%d, errmsg=%s", resp.ErrCode, resp.ErrMsg)
	}
	return nil
}

func dingtalkSignURL(webhookURL, secret string) (string, error) {
	timestamp := fmt.Sprintf("%d", time.Now().UnixMilli())
	stringToSign := timestamp + "\n" + secret
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(stringToSign))
	sign := url.QueryEscape(base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	u, err := url.Parse(webhookURL)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("timestamp", timestamp)
	q.Set("sign", sign)
	u.RawQuery = q.Encode()
	return u.String(), nil
}
