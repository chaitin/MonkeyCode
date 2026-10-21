package logging

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"log/slog"
	"net"
	"os"
	"reflect"
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
	switch {
	case errors.As(err, &database):
		code, cause = "database_error", database
		extra = append(extra, slog.String("sqlstate", database.Code))
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
	attrs := []slog.Attr{slog.String("error_code", code), slog.String("error_type", reflect.TypeOf(cause).String())}
	var dependency *dependencyError
	if errors.As(err, &dependency) {
		attrs = append(attrs, slog.String("dependency", dependency.name))
	}
	return append(attrs, extra...)
}
