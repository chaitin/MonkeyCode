package mcp

import (
	"net/netip"
	"net/url"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestSkipTLSVerifyEnforcesBlacklist(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	server := tlsTestRemote(t)
	for _, proxied := range []bool{false, true} {
		s := (&Service{}).WithNetworkSettings(&networkTestSettings{
			blocked: []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")},
		})
		c := resource.Object{
			"skip_tls_verify": true,
			"oauth_config":    oauthConfig{ClientID: "tls-client", TokenURL: server.URL + "/token"},
		}
		if proxied {
			p := tlsTestProxy(t, false)
			s.WithProxyResolver(tlsProxyResolver(p.URL))
			c["proxy_id"] = "proxy"
		}
		h, err := s.clientFor(t.Context(), c)
		if err != nil {
			t.Fatal(err)
		}
		_, err = discoverWithClient(t.Context(), server.URL, nil, h)
		if err == nil || upstreamFailure(err, "").Code != "mcp_address_denied" {
			t.Fatalf("跳过 TLS 校验不得绕过 MCP 黑名单: proxy=%v err=%v", proxied, err)
		}
		_, err = s.exchange(t.Context(), c, url.Values{"grant_type": {"client_credentials"}})
		if err == nil || upstreamFailure(err, "").Code != "mcp_address_denied" {
			t.Fatalf("跳过 TLS 校验不得绕过 OAuth 黑名单: proxy=%v err=%v", proxied, err)
		}
	}
}
