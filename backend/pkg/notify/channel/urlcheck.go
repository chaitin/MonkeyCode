package channel

import (
	"context"
	"fmt"
	"strings"

	"github.com/chaitin/MonkeyCode/backend/pkg/netguard"
)

var blockedHeaderKeys = map[string]struct{}{
	"host":              {},
	"transfer-encoding": {},
	"content-length":    {},
	"connection":        {},
}

func ValidateWebhookURL(rawURL string, blockPrivateNetwork ...bool) error {
	block := true
	if len(blockPrivateNetwork) > 0 {
		block = blockPrivateNetwork[0]
	}
	if err := netguard.New(block).ValidateURL(context.Background(), rawURL); err != nil {
		return fmt.Errorf("invalid webhook url: %w", err)
	}
	return nil
}

func ValidateHeaders(headers map[string]string) error {
	for k := range headers {
		if _, blocked := blockedHeaderKeys[strings.ToLower(k)]; blocked {
			return fmt.Errorf("header %q is not allowed", k)
		}
	}
	return nil
}

// validateURLChannelCfg 是 URL 类渠道（dingtalk/feishu/wecom/webhook）的共用校验：
// 校验 webhook URL 与 Header 的 SSRF 风险，让各 sender 在 Validate 里直接复用。
func validateURLChannelCfg(cfg *ChannelConfig) error {
	if err := ValidateWebhookURL(cfg.WebhookURL, cfg.BlockPrivateNetwork); err != nil {
		return err
	}
	return ValidateHeaders(cfg.Headers)
}
