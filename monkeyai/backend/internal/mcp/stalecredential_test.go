package mcp

import (
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestStaleCredentialRecovery(t *testing.T) {
	for _, tt := range []struct{ method, hint string }{{"oauth", "重新授权"}, {"http_header", "重新提交认证请求头"}} {
		t.Run(tt.method, func(t *testing.T) {
			c := resource.Object{"authorization_method": tt.method, "authorization_mode": "independent", "config_revision": float64(2)}
			cred := resource.Object{"id": "old", "config_revision": float64(1), "connection_status": "error", "last_checked_at": "yesterday", "last_error": "DNS error", "oauth_access_token": "old", "http_headers": map[string]string{"X-Key": "old"}}
			view := credentialView(c, cred, nil)
			if view.String("id") != "old" || view.String("authorization_status") != "authorization_required" || view.String("connection_status") != "unknown" || view["last_checked_at"] != nil || view["last_error"] != nil {
				t.Fatal("旧配置的凭证不应显示上次连接结果")
			}
			_, err := (&Service{}).discoverTools(t.Context(), c, cred)
			if e := resource.AsError(err); err == nil || e.Status != 403 || e.Code != "authorization_required" || !strings.Contains(e.Message, tt.hint) {
				t.Fatalf("未返回当前认证方式的恢复提示：%v", err)
			}
			cred["config_revision"] = c["config_revision"]
			view = credentialView(c, cred, nil)
			if view.String("authorization_status") != "authorized" || view.String("last_error") != "DNS error" || view.String("connection_status") != "error" {
				t.Fatal("当前版本的真实连接结果应保留")
			}
		})
	}
}
