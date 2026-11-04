package mcp

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestUpstreamFailureCodes(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code string
	}{
		{context.DeadlineExceeded, "mcp_timeout"},
		{&net.DNSError{Err: "private-host", Name: "private-host"}, "mcp_dns_failed"},
		{&tls.CertificateVerificationError{Err: x509.UnknownAuthorityError{}}, "mcp_tls_failed"},
		{remoteStatus(401), "mcp_upstream_unauthorized"},
		{remoteStatus(403), "mcp_upstream_forbidden"},
		{remoteStatus(404), "mcp_upstream_not_found"},
		{remoteStatus(429), "mcp_upstream_rate_limited"},
		{remoteStatus(503), "mcp_upstream_unavailable"},
		{remoteStatus(302), "mcp_redirect_denied"},
		{&rpcError{Code: -32603, Message: "private-rpc-message"}, "upstream_error"},
		{errors.New("private-response-body"), "oauth_discovery_failed"},
	} {
		t.Run(tc.code, func(t *testing.T) {
			wrapped := fmt.Errorf("request: %w", &url.Error{Op: "GET", URL: "https://user:private-secret@example.com?token=private-token", Err: tc.err})
			fault := upstreamFailure(wrapped, "oauth_discovery_failed")
			if fault.Code != tc.code || fault.Status != 502 || !errors.Is(fault, wrapped) {
				t.Fatalf("错误链或分类丢失: %+v", fault)
			}
			if strings.Contains(fault.Message, "private-") {
				t.Fatalf("错误文案泄露底层详情: %s", fault.Message)
			}
		})
	}
}

func TestOAuthDiscoveryFailureCodes(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	for _, tc := range []struct{ kind, code string }{
		{"missing", "oauth_metadata_not_found"},
		{"invalid", "oauth_metadata_invalid"},
		{"no_registration", "oauth_registration_unsupported"},
		{"no_pkce", "oauth_pkce_unsupported"},
		{"no_auth_method", "oauth_auth_method_unsupported"},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			var base string
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.HasPrefix(r.URL.Path, "/.well-known/") || strings.Contains(r.URL.Path, "protected-resource") || tc.kind == "missing" {
					w.WriteHeader(404)
					return
				}
				if tc.kind == "invalid" {
					w.Write([]byte("<html>private-response</html>"))
					return
				}
				metadata := resource.Object{"issuer": base, "authorization_endpoint": base + "/auth", "token_endpoint": base + "/token", "registration_endpoint": base + "/register"}
				switch tc.kind {
				case "no_registration":
					delete(metadata, "registration_endpoint")
				case "no_pkce":
					metadata["code_challenge_methods_supported"] = []string{"plain"}
				case "no_auth_method":
					metadata["token_endpoint_auth_methods_supported"] = []string{"private_key_jwt"}
				}
				resource.JSON(r.Context(), w, 200, metadata)
			}))
			defer s.Close()
			base = s.URL
			_, err := discoverOAuth(t.Context(), base)
			if fault, ok := errors.AsType[*resource.Error](err); !ok || fault.Code != tc.code {
				t.Fatalf("错误分类不准确: %v", err)
			}
		})
	}
}

func TestOAuthRegistrationFailureCodes(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	for _, tc := range []struct {
		status int
		code   string
	}{
		{400, "oauth_registration_rejected"}, {401, "oauth_registration_rejected"},
		{404, "oauth_registration_unsupported"}, {405, "oauth_registration_unsupported"},
		{429, "mcp_upstream_rate_limited"}, {503, "mcp_upstream_unavailable"},
		{201, "oauth_registration_response_invalid"},
	} {
		t.Run(fmt.Sprint(tc.status), func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				w.Write([]byte(`{"error":"private-upstream-detail","client_secret":"private-secret"}`))
			}))
			defer s.Close()
			_, err := registerOAuthClient(t.Context(), oauthConfig{RegistrationURL: s.URL}, "https://app.example/callback")
			fault, ok := errors.AsType[*resource.Error](err)
			if !ok || fault.Code != tc.code || strings.Contains(fault.Message, "private-") {
				t.Fatalf("注册分类或脱敏错误: %v", err)
			}
		})
	}
}
