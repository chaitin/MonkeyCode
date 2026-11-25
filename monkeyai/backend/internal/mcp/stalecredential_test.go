package mcp

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestStaleCredentialRecovery(t *testing.T) {
	for _, method := range []string{"oauth", "http_header"} {
		t.Run(method, func(t *testing.T) {
			c := resource.Object{"authorization_method": method, "authorization_mode": "independent", "config_revision": float64(2)}
			cred := resource.Object{"id": "old", "config_revision": float64(1), "connection_status": "error", "last_checked_at": "yesterday", "last_error": "DNS error", "oauth_access_token": "old", "oauth_refresh_token": "refresh", "http_headers": map[string]string{"X-Key": "old"}}
			view := credentialView(c, cred, nil)
			if view.String("id") != "old" || view.String("connection_status") != "unknown" || view["last_checked_at"] != nil || view["last_error"] != nil {
				t.Fatal("旧配置的凭证不应显示上次连接结果")
			}
			if view.String("authorization_status") != "authorized" || credentialStatus(c, cred) != "authorized" {
				t.Fatal("已有凭证应跟随连接配置继续使用")
			}
			cred["config_revision"] = c["config_revision"]
			view = credentialView(c, cred, nil)
			if view.String("authorization_status") != "authorized" || view.String("last_error") != "DNS error" || view.String("connection_status") != "error" {
				t.Fatal("当前版本的真实连接结果应保留")
			}
		})
	}
}
