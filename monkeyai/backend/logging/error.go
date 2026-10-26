package logging

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"log/slog"
	"net"
	"net/url"
	"os"
	"reflect"
	"strings"
	"syscall"

	"github.com/jackc/pgx/v5/pgconn"
)

type dependencyError struct {
	name  string
	cause error
}

func (e *dependencyError) Error() string { return "依赖检查失败" }
func (e *dependencyError) Unwrap() error { return e.cause }
func Dependency(name string, err error) error {
	if err == nil {
		return nil
	}
	return &dependencyError{name, err}
}

// DiagnosticCoder lets domain errors supply a stable, non-sensitive code.
type DiagnosticCoder interface {
	DiagnosticCode() string
}

// ErrorAttrs never formats the error, URL, SQL, certificate or its payload.
func ErrorAttrs(err error) []slog.Attr {
	if err == nil {
		return nil
	}
	code := "internal_error"
	cause := err
	var extra []slog.Attr
	var dns *net.DNSError
	var database *pgconn.PgError
	var certificate *tls.CertificateVerificationError
	var authority x509.UnknownAuthorityError
	var host x509.HostnameError
	var invalid x509.CertificateInvalidError
	var network net.Error
	var coded DiagnosticCoder
	switch {
	case errors.As(err, &database):
		code, cause = "database_error", database
		extra = append(extra, slog.String("sqlstate", database.Code))
	case errors.As(err, &coded) && coded.DiagnosticCode() != "":
		code = coded.DiagnosticCode()
	case errors.As(err, &dns):
		code, cause = "dns_failed", dns
	case errors.As(err, &certificate):
		code, cause = "tls_verification_failed", certificate
	case errors.As(err, &authority):
		code, cause = "tls_verification_failed", authority
	case errors.As(err, &host):
		code, cause = "tls_verification_failed", host
	case errors.As(err, &invalid):
		code, cause = "tls_verification_failed", invalid
	case errors.Is(err, syscall.ECONNREFUSED):
		code = "connection_refused"
		extra = append(extra, slog.Int("errno", int(syscall.ECONNREFUSED)))
	case errors.Is(err, syscall.ECONNRESET):
		code = "connection_reset"
		extra = append(extra, slog.Int("errno", int(syscall.ECONNRESET)))
	case errors.Is(err, syscall.EHOSTUNREACH):
		code = "host_unreachable"
		extra = append(extra, slog.Int("errno", int(syscall.EHOSTUNREACH)))
	case errors.Is(err, syscall.ENETUNREACH):
		code = "network_unreachable"
		extra = append(extra, slog.Int("errno", int(syscall.ENETUNREACH)))
	case errors.Is(err, context.Canceled):
		code = "client_canceled"
	case errors.Is(err, context.DeadlineExceeded):
		code = "deadline_exceeded"
		extra = append(extra, slog.Bool("timeout", true))
	case errors.Is(err, syscall.EROFS):
		code = "read_only_filesystem"
	case errors.Is(err, syscall.ENOSPC):
		code = "disk_full"
	case errors.Is(err, os.ErrPermission):
		code = "permission_denied"
	case errors.Is(err, os.ErrNotExist):
		code = "not_found"
	case errors.As(err, &network) && network.Timeout():
		code, cause = "network_timeout", network
		extra = append(extra, slog.Bool("timeout", true))
	}
	if code == "tls_verification_failed" {
		extra = append(extra, slog.String("tls_reason", tlsReason(err)))
	}
	var op *net.OpError
	if errors.As(err, &op) && op.Op != "" {
		extra = append(extra, slog.String("net_op", strings.ReplaceAll(op.Op, " ", "_")))
	}
	if inner, ok := innerURLCause(err); ok {
		extra = append(extra, slog.String("cause_type", reflect.TypeOf(inner).String()))
	}
	attrs := []slog.Attr{slog.String("error_code", code), slog.String("error_type", reflect.TypeOf(cause).String())}
	var dependency *dependencyError
	if errors.As(err, &dependency) {
		attrs = append(attrs, slog.String("dependency", dependency.name))
	}
	return append(attrs, extra...)
}

func tlsReason(err error) string {
	var authority x509.UnknownAuthorityError
	var host x509.HostnameError
	var invalid x509.CertificateInvalidError
	switch {
	case errors.As(err, &host):
		return "hostname_mismatch"
	case errors.As(err, &authority):
		return "unknown_authority"
	case errors.As(err, &invalid) && invalid.Reason == x509.Expired:
		return "expired"
	case errors.As(err, &invalid):
		return "invalid"
	}
	return "unknown"
}

// innerURLCause unwraps nested *url.Error values so logs can show the root
// transport error's type without exposing its URL or message.
func innerURLCause(err error) (error, bool) {
	cause := err
	for range 8 {
		urlErr, ok := errors.AsType[*url.Error](cause)
		if !ok || urlErr.Err == nil {
			break
		}
		cause = urlErr.Err
	}
	return cause, cause != err
}
