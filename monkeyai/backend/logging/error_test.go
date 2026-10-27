package logging

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strings"
	"syscall"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestErrorClassificationAndWrappedMessages(t *testing.T) {
	for _, test := range []struct {
		name       string
		err        error
		code, kind string
	}{
		{"DNS", &net.DNSError{Name: "private-host", Err: "private-detail"}, "dns_failed", "*net.DNSError"},
		{"拒绝连接", syscall.ECONNREFUSED, "connection_refused", ""},
		{"重置连接", syscall.ECONNRESET, "connection_reset", ""},
		{"主机不可达", syscall.EHOSTUNREACH, "host_unreachable", ""},
		{"网络不可达", syscall.ENETUNREACH, "network_unreachable", ""},
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
				if a.Key != "error_message" && strings.Contains(a.Value.String(), "private-") {
					t.Fatal("错误分类泄漏秘密", a)
				}
			}
			if values["error_message"] != fmt.Sprint(Dependency("database", err)) {
				t.Fatalf("原始错误丢失: %v", values)
			}
			if values["error_code"] != test.code || values["dependency"] != "database" || test.kind != "" && values["error_type"] != test.kind {
				t.Fatalf("分类错误: %v", values)
			}
		})
	}
}

func TestErrorAttrsTransportDetails(t *testing.T) {
	for _, test := range []struct {
		name       string
		err        error
		key, value string
	}{
		{"域名不匹配", &tls.CertificateVerificationError{Err: x509.HostnameError{Host: "private-host"}}, "tls_reason", "hostname_mismatch"},
		{"未知 CA", &tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}}, "tls_reason", "unknown_authority"},
		{"证书过期", &tls.CertificateVerificationError{Err: x509.CertificateInvalidError{Reason: x509.Expired}}, "tls_reason", "expired"},
		{"代理连接", &net.OpError{Op: "proxyconnect", Net: "tcp", Err: syscall.ECONNREFUSED}, "net_op", "proxyconnect"},
		{"TLS 告警", &net.OpError{Op: "remote error", Err: errors.New("private-alert")}, "net_op", "remote_error"},
	} {
		t.Run(test.name, func(t *testing.T) {
			values := map[string]string{}
			for _, a := range ErrorAttrs(&url.Error{Op: "Get", URL: "https://private-host/path", Err: test.err}) {
				values[a.Key] = a.Value.String()
			}
			if values[test.key] != test.value {
				t.Fatalf("传输细节错误: %v", values)
			}
		})
	}
}

func TestErrorAttrsKeepsURLRootCause(t *testing.T) {
	err := &url.Error{Op: "Get", URL: "https://private-user:private-password@example.test/path?token=private-token", Err: domainError{code: "upstream_address_blocked"}}
	values := map[string]string{}
	for _, a := range ErrorAttrs(err) {
		values[a.Key] = a.Value.String()
		if a.Key != "error_message" && (strings.Contains(a.Value.String(), "private-") || strings.Contains(a.Value.String(), "example.test")) {
			t.Fatal("根错误分类泄漏秘密", a)
		}
	}
	if values["error_code"] != "upstream_address_blocked" || values["error_type"] != "*url.Error" || values["cause_type"] != "logging.domainError" {
		t.Fatalf("根错误分类错误: %v", values)
	}
}

type domainError struct{ code string }

func (e domainError) Error() string          { return "domain failure" }
func (e domainError) DiagnosticCode() string { return e.code }

func TestEventKeepsPollDiagnostics(t *testing.T) {
	logger, out := testLogger()
	err := &url.Error{Op: "Get", URL: "https://private-host.example/path?video_id=private", Err: domainError{code: "upstream_address_blocked"}}
	Event(t.Context(), logger, slog.LevelWarn, "video.job.retry", "重试", "module", "videogen", "operation", "poll", "job_id", "job-1", "failures", int32(1), "phase", "query_provider", "proxy_used", true, "error", err)
	row := records(t, out)[0]
	if row["phase"] != "query_provider" || row["proxy_used"] != true {
		t.Fatalf("阶段或代理标记丢失: %v", row)
	}
	fields, ok := row["error"].(map[string]any)
	if !ok || fields["error_code"] != "upstream_address_blocked" || fields["error_type"] != "*url.Error" || fields["cause_type"] != "logging.domainError" {
		t.Fatalf("根错误字段错误: %v", row)
	}
	if fields["error_message"] != err.Error() {
		t.Fatal(out.String())
	}
}

func TestDerivedHandlerPreservesSource(t *testing.T) {
	logger, out := testLogger()
	Event(t.Context(), logger.With("module", "proxy").WithGroup("call"), slog.LevelInfo, "test.event", "测试")
	row := records(t, out)[0]
	source, ok := row["source"].(map[string]any)
	if !ok || source["file"] != "error_test.go" || !strings.Contains(source["function"].(string), "TestDerivedHandlerPreservesSource") {
		t.Fatalf("源码位置被包装器覆盖: %v", row)
	}
}
