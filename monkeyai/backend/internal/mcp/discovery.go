package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
)

var metadataUnavailable = errors.New("OAuth 元数据端点不存在")
var resourceMetadataParameter = regexp.MustCompile(`(?i)(?:^|,)\s*resource_metadata\s*=\s*"([^"]+)"`)

type protectedResourceMetadata struct {
	Resource             string   `json:"resource"`
	AuthorizationServers []string `json:"authorization_servers"`
	Scopes               []string `json:"scopes_supported"`
}

type authorizationServerMetadata struct {
	Issuer           string   `json:"issuer"`
	AuthorizationURL string   `json:"authorization_endpoint"`
	TokenURL         string   `json:"token_endpoint"`
	RegistrationURL  string   `json:"registration_endpoint"`
	AuthMethods      []string `json:"token_endpoint_auth_methods_supported"`
	PKCEMethods      []string `json:"code_challenge_methods_supported"`
}

func discoveryURL(value, source string) bool {
	if !validURL(value) {
		return false
	}
	u, err := url.Parse(value)
	if err != nil {
		return false
	}
	origin, err := url.Parse(source)
	return err == nil && origin != nil && (origin.Scheme != "https" || u.Scheme == "https")
}

func readOAuthMetadata(ctx context.Context, h *http.Client, target string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := h.Do(req)
	if err != nil {
		return err
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			slog.WarnContext(ctx, "关闭 OAuth 元数据响应失败", "operation", "read_metadata", "failure", safeMCPFailure(err))
		}
	}()
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusMethodNotAllowed {
		return metadataUnavailable
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("OAuth 元数据请求失败")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 || json.Unmarshal(data, out) != nil {
		return fmt.Errorf("OAuth 元数据响应无效")
	}
	return nil
}

func metadataURLs(issuer, kind string) []string {
	u, err := url.Parse(issuer)
	if err != nil {
		return nil
	}
	origin := u.Scheme + "://" + u.Host
	path := u.EscapedPath()
	out := []string{origin + "/.well-known/" + kind + path}
	if kind == "oauth-protected-resource" {
		if path != "" {
			out = append(out, origin+"/.well-known/"+kind)
		}
	} else {
		// RFC 8414 将 issuer 路径放在 well-known 后，OIDC 则放在前面。
		if path != "" {
			out = append(out, origin+"/.well-known/openid-configuration"+path)
		}
		out = append(out, origin+strings.TrimRight(path, "/")+"/.well-known/openid-configuration")
	}
	return out
}

func discoverOAuth(ctx context.Context, target string) (oauthConfig, error) {
	fail := func() (oauthConfig, error) {
		return oauthConfig{}, fmt.Errorf("OAuth 自动发现元数据无效或不支持动态注册")
	}
	if !validURL(target) {
		return fail()
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	h := client()
	defer h.CloseIdleConnections()

	// 不附带现有凭证；所有发现请求复用 MCP 的地址限制及禁止重定向策略。
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return fail()
	}
	req.Header.Set("Accept", "application/json, text/event-stream")
	resp, err := h.Do(req)
	if err != nil {
		return fail()
	}
	if err := resp.Body.Close(); err != nil {
		return fail()
	}
	var metadataURL string
	if resp.StatusCode == http.StatusUnauthorized {
		for _, challenge := range resp.Header.Values("WWW-Authenticate") {
			if len(challenge) < 7 || !strings.EqualFold(challenge[:7], "Bearer ") {
				continue
			}
			if match := resourceMetadataParameter.FindStringSubmatch(challenge[7:]); len(match) == 2 {
				metadataURL = match[1]
				break
			}
		}
	}
	candidates := metadataURLs(target, "oauth-protected-resource")
	if metadataURL != "" {
		if !discoveryURL(metadataURL, target) {
			return fail()
		}
		candidates = []string{metadataURL}
	}
	var prm protectedResourceMetadata
	found := false
	for _, candidate := range candidates {
		err = readOAuthMetadata(ctx, h, candidate, &prm)
		if err == nil {
			found = true
			break
		}
		if !errors.Is(err, metadataUnavailable) || metadataURL != "" {
			return fail()
		}
	}

	u, err := url.Parse(target)
	if err != nil {
		return fail()
	}
	issuer := u.Scheme + "://" + u.Host
	resourceURL := *u
	resourceURL.RawQuery, resourceURL.ForceQuery = "", false
	o := oauthConfig{Mode: "dynamic", Resource: resourceURL.String()}
	if found {
		// 将资源标识绑定到用户配置的 MCP URL，避免接受其他资源的元数据。
		resourceURL, err := url.Parse(prm.Resource)
		if err != nil || !discoveryURL(prm.Resource, target) || resourceURL.Scheme != u.Scheme || resourceURL.Host != u.Host || resourceURL.EscapedPath() != u.EscapedPath() || resourceURL.RawQuery != "" || len(prm.AuthorizationServers) == 0 {
			return fail()
		}
		issuer = prm.AuthorizationServers[0]
		o.Resource = prm.Resource
		o.Scopes = strings.Join(prm.Scopes, " ")
	}
	if !discoveryURL(issuer, target) {
		return fail()
	}
	issuerURL, err := url.Parse(issuer)
	if err != nil {
		return fail()
	}
	if issuerURL.RawQuery != "" {
		return fail()
	}
	var metadata authorizationServerMetadata
	found = false
	for _, candidate := range metadataURLs(issuer, "oauth-authorization-server") {
		err = readOAuthMetadata(ctx, h, candidate, &metadata)
		if err == nil {
			found = true
			break
		}
		if !errors.Is(err, metadataUnavailable) {
			return fail()
		}
	}
	if !found || metadata.Issuer != issuer || !discoveryURL(metadata.AuthorizationURL, issuer) || !discoveryURL(metadata.TokenURL, issuer) || !discoveryURL(metadata.RegistrationURL, issuer) {
		return fail()
	}
	if metadata.PKCEMethods != nil && !slices.Contains(metadata.PKCEMethods, "S256") {
		return fail()
	}
	o.AuthorizationURL, o.TokenURL, o.RegistrationURL = metadata.AuthorizationURL, metadata.TokenURL, metadata.RegistrationURL
	methods := metadata.AuthMethods
	if methods == nil {
		methods = []string{"client_secret_basic"}
	}
	for _, method := range []string{"none", "client_secret_basic", "client_secret_post"} {
		if slices.Contains(methods, method) {
			o.TokenAuthMethod = method
			return o, nil
		}
	}
	return fail()
}
