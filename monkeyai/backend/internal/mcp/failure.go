package mcp

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func failure(code string, cause error) *resource.Error {
	return &resource.Error{Status: http.StatusBadGateway, Code: code, Cause: cause}
}

func upstreamFailure(err error, fallback string) *resource.Error {
	if fault, ok := errors.AsType[*resource.Error](err); ok {
		return fault
	}
	if network, ok := errors.AsType[net.Error](err); errors.Is(err, context.DeadlineExceeded) || ok && network.Timeout() {
		return failure("mcp_timeout", err)
	}
	if _, ok := errors.AsType[*net.DNSError](err); ok {
		return failure("mcp_dns_failed", err)
	}
	if _, ok := errors.AsType[*tls.CertificateVerificationError](err); ok {
		return failure("mcp_tls_failed", err)
	}
	if _, ok := errors.AsType[x509.UnknownAuthorityError](err); ok {
		return failure("mcp_tls_failed", err)
	}
	if _, ok := errors.AsType[x509.HostnameError](err); ok {
		return failure("mcp_tls_failed", err)
	}
	if status, ok := errors.AsType[remoteStatus](err); ok {
		code := fallback
		switch {
		case status == 401:
			code = "mcp_upstream_unauthorized"
		case status == 403:
			code = "mcp_upstream_forbidden"
		case status == 404:
			code = "mcp_upstream_not_found"
		case status == 429:
			code = "mcp_upstream_rate_limited"
		case status >= 500:
			code = "mcp_upstream_unavailable"
		case status >= 300 && status < 400:
			code = "mcp_redirect_denied"
		}
		return failure(code, err)
	}
	if _, ok := errors.AsType[*rpcError](err); ok {
		return failure("upstream_error", err)
	}
	if _, ok := errors.AsType[*net.OpError](err); ok {
		return failure("mcp_connect_failed", err)
	}
	return failure(fallback, err)
}

func exchangeFailure(err error, fallback string) *resource.Error {
	if errors.Is(err, invalidGrant) {
		return failure("oauth_credentials_expired", err)
	}
	if token, ok := errors.AsType[tokenExchangeError](err); ok {
		code := "oauth_token_response_invalid"
		if token.reason == "upstream_http_error" {
			code = "oauth_token_rejected"
			if token.status == http.StatusTooManyRequests || token.status >= 500 {
				return upstreamFailure(remoteStatus(token.status), fallback)
			}
		}
		return failure(code, err)
	}
	return upstreamFailure(err, fallback)
}
