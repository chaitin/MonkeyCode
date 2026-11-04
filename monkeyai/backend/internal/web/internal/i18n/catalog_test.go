package i18n

import (
	"context"
	"strings"
	"testing"
)

func TestSpecificMessagesDoNotCollapseIntoCodeFallback(t *testing.T) {
	ctx := context.WithValue(t.Context(), localeKey{}, "en-US")
	for _, tc := range []struct{ code, source, want string }{
		{"invalid_request", "评分必须为 1 至 5", "The rating must be between 1 and 5."},
		{"invalid_request", "名称必须为字符串", "The name must be a string."},
		{"invalid_token", "缺少 Bearer access token", "A Bearer access token is required."},
		{"authorization_state_unavailable", "设备申请暂不可用", "The device request is temporarily unavailable."},
		{"device_identity_required", "需要先证明本机身份", "Verify this device's identity first."},
		{"invalid_request", "参数 duration 不受支持", "Parameter duration is not supported."},
		{"invalid_request", "技能包超过 16 MiB", "The skill package exceeds 16 MiB."},
		{"model_error", "获取上游模型列表失败：上游返回 HTTP 403，请检查协议和密钥", "The upstream model list could not be retrieved: the upstream returned HTTP 403. Check the protocol and key."},
	} {
		if actual := Text(ctx, tc.code, tc.source); actual != tc.want {
			t.Errorf("%s / %s: %q, expected %q", tc.code, tc.source, actual, tc.want)
		}
	}
}

func TestTranslationsAreCompleteAndSafe(t *testing.T) {
	for code, values := range messages {
		if strings.TrimSpace(values["zh-CN"]) == "" || strings.TrimSpace(values["en-US"]) == "" {
			t.Errorf("错误码缺少翻译: %s", code)
		}
	}
	ctx := context.WithValue(t.Context(), localeKey{}, "en-US")
	for _, text := range []string{"private-token=secret", "读取未知内部配置 private-password 失败", "unknown upstream response", "Could not parse the advanced model settings: private-token=secret"} {
		if result := Text(ctx, "unknown_error", text); result != messages["request_failed"]["en-US"] {
			t.Errorf("未识别的内部错误未使用安全兜底: %q", result)
		}
	}
	if result := Text(ctx, "model_error", "解析模型高级配置: private-token=secret"); strings.Contains(result, "private-token") {
		t.Fatal("包装错误泄露内部原文")
	}
}
