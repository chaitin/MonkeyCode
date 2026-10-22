package logging

import (
	"context"
	"crypto/x509"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strings"
	"syscall"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestErrorClassificationAndWrappedSecrets(t *testing.T) {
	for _, test := range []struct {
		name       string
		err        error
		code, kind string
	}{
		{"DNS", &net.DNSError{Name: "private-host", Err: "private-detail"}, "dns_failed", "*net.DNSError"},
		{"拒绝连接", syscall.ECONNREFUSED, "connection_refused", ""},
		{"重置连接", syscall.ECONNRESET, "connection_reset", ""},
		{"证书", x509.HostnameError{Host: "private-host"}, "tls_verification_failed", "x509.HostnameError"},
		{"数据库", &pgconn.PgError{Code: "08006", Message: "private-message", Detail: "private-detail"}, "database_error", "*pgconn.PgError"},
		{"取消", context.Canceled, "client_canceled", ""},
		{"超时", context.DeadlineExceeded, "deadline_exceeded", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := fmt.Errorf("private-wrapper: %w", &url.Error{Op: "private-operation", URL: "https://private-user:private-password@example.test?token=private-token", Err: test.err})
			attrs := ErrorAttrs(Dependency("database", err))
			values := map[string]string{}
			for _, a := range attrs {
				values[a.Key] = a.Value.String()
				if strings.Contains(a.Value.String(), "private-") {
					t.Fatal("错误分类泄漏秘密", a)
				}
			}
			if values["error_code"] != test.code || values["dependency"] != "database" || test.kind != "" && values["error_type"] != test.kind {
				t.Fatalf("分类错误: %v", values)
			}
		})
	}
}
func TestDerivedHandlerPreservesSource(t *testing.T) {
	r, out, _, _ := runtimeTest(t)
	Event(t.Context(), r.Logger().With("module", "proxy").WithGroup("call"), slog.LevelInfo, "test.event", "测试")
	row := records(t, out)[0]
	source, ok := row["source"].(map[string]any)
	if !ok || source["file"] != "error_test.go" || !strings.Contains(source["function"].(string), "TestDerivedHandlerPreservesSource") {
		t.Fatalf("源码位置被包装器覆盖: %v", row)
	}
}
