package identity

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"
)

func authorizationValues(clientID, redirectURI string) url.Values {
	return url.Values{
		"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {redirectURI},
		"state": {"authorization-test"}, "code_challenge": {strings.Repeat("A", 43)},
		"code_challenge_method": {"S256"},
	}
}

func TestAuthorizationRedirectPolicy(t *testing.T) {
	for _, clientID := range []string{"monkeyai-desktop", "monkeyai-mobile"} {
		t.Run(clientID, func(t *testing.T) {
			s := NewService(nil, nil, "https://ai.example.com")
			for _, redirect := range []string{
				Clients[clientID].RedirectURI,
				"http://127.0.0.1:1/oauth/callback",
				"http://127.0.0.1:54321/oauth/callback",
				"http://localhost:54321/oauth/callback",
				"http://[::1]:65535/oauth/callback",
			} {
				if clientID != "monkeyai-desktop" && redirect != Clients[clientID].RedirectURI {
					continue
				}
				t.Run(redirect, func(t *testing.T) {
					request, err := s.newAuthorizationRequest(authorizationValues(clientID, redirect))
					if err != nil || request.RedirectURI != redirect {
						t.Fatalf("合法回调未保留: request=%+v err=%v", request, err)
					}
				})
			}
			for _, redirect := range []string{
				"", "https://review.invalid/callback", "http://192.0.2.10/callback",
				"javascript:void(0)//", "/relative/callback", "//review.invalid/callback",
				"http://127.0.0.1.review.invalid:54321/oauth/callback",
				"http://127.0.0.1:54321@review.invalid/oauth/callback",
				"http://user@127.0.0.1:54321/oauth/callback",
				"http://localhost.attacker.example:54321/oauth/callback", "http://127.0.0.2:54321/oauth/callback",
				"https://127.0.0.1:54321/oauth/callback", "http://[::ffff:127.0.0.1]:54321/oauth/callback",
				"http://127.0.0.1:0/oauth/callback", "http://127.0.0.1:65536/oauth/callback",
				"http://127.0.0.1:/oauth/callback", "http://127.0.0.1:abc/oauth/callback",
				"http://127.0.0.1:54321/wrong", "http://127.0.0.1:54321/oauth/callback/extra",
				"http://127.0.0.1:54321/oauth/%63allback", "http://127.0.0.1:54321/other/../oauth/callback",
				"http://127.0.0.1:54321/oauth/callback?next=https://review.invalid",
				"http://127.0.0.1:54321/oauth/callback?", "http://127.0.0.1:54321/oauth/callback#",
				Clients[clientID].RedirectURI + ".evil", Clients[clientID].RedirectURI + "#fragment",
				Clients[clientID].RedirectURI + "?next=evil", Clients[clientID].RedirectURI + "#",
				"monkeyai-desktop-evil://oauth/callback", "monkeyai-desktop://oauth.evil/callback",
				"monkeyai-desktop://user@oauth/callback", "monkeyai-mobile://user@oauth/callback",
			} {
				t.Run(redirect, func(t *testing.T) {
					response := httptest.NewRecorder()
					// 无数据库服务可确认非法输入在持久化和重定向前被拒绝。
					s.OAuthRouter().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/authorize?"+authorizationValues(clientID, redirect).Encode(), nil))
					var result protocolError
					if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
						t.Fatal(err)
					}
					if response.Code != http.StatusBadRequest || result.Code != "invalid_request" || response.Header().Get("Location") != "" {
						t.Fatalf("非法回调未被本地拒绝: status=%d body=%s", response.Code, response.Body)
					}
				})
			}
			other := "monkeyai-mobile"
			if clientID == other {
				other = "monkeyai-desktop"
			}
			redirects := []string{Clients[other].RedirectURI}
			if clientID == "monkeyai-mobile" {
				redirects = append(redirects, "http://127.0.0.1:54321/oauth/callback", "http://localhost:54321/oauth/callback", "http://[::1]:54321/oauth/callback")
			}
			for _, redirect := range redirects {
				if _, err := s.newAuthorizationRequest(authorizationValues(clientID, redirect)); err == nil {
					t.Fatalf("不能使用其他客户端的回调规则: %s", redirect)
				}
			}
		})
	}
}

func TestEmptyScopeRequiresBrowserConsent(t *testing.T) {
	for _, clientID := range []string{"monkeyai-desktop", "monkeyai-mobile"} {
		t.Run(clientID, func(t *testing.T) {
			pool := emailDatabase(t)
			s := NewService(pool, authenticationStub{json.RawMessage(`{}`)}, "https://ai.example.com")
			user := grantUser(t, s)
			values := authorizationValues(clientID, Clients[clientID].RedirectURI)
			request, err := s.BeginAuthorization(t.Context(), values)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.CompleteAuthorization(t.Context(), request.ID, user.ID); err == nil {
				t.Fatal("空权限也不能自动完成授权")
			}
			cookie := &http.Cookie{Name: sessionCookie, Value: "empty-scope-consent"}
			if err := s.createBrowserSession(t.Context(), user.ID, tokenHash(cookie.Value), "password", s.now().Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
			path := "/client-requests/" + request.ID
			view := httptest.NewRecorder()
			get := httptest.NewRequest(http.MethodGet, path, nil)
			get.AddCookie(cookie)
			s.AuthRouter().ServeHTTP(view, get)
			var result struct {
				Authenticated bool     `json:"authenticated"`
				Consent       bool     `json:"consent_required"`
				CSRF          string   `json:"csrf_token"`
				Scopes        []string `json:"scopes"`
			}
			if err := json.Unmarshal(view.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if view.Code != http.StatusOK || !result.Authenticated || !result.Consent || result.CSRF == "" || result.Scopes == nil || len(result.Scopes) != 0 {
				t.Fatalf("空权限请求没有要求确认: status=%d body=%s", view.Code, view.Body)
			}
			for _, tc := range []struct {
				name, csrf, body string
				want             int
			}{
				{"自动完成", "", "", http.StatusForbidden},
				{"缺少批准内容", result.CSRF, `{}`, http.StatusForbidden},
				{"批准扩权", result.CSRF, `{"approved_scopes":["session:read"]}`, http.StatusConflict},
				{"明确确认登录", result.CSRF, `{"approved_scopes":[]}`, http.StatusOK},
			} {
				t.Run(tc.name, func(t *testing.T) {
					r := httptest.NewRequest(http.MethodPost, path+"/complete", strings.NewReader(tc.body))
					r.AddCookie(cookie)
					r.Header.Set("X-CSRF-Token", tc.csrf)
					r.Header.Set("Origin", s.publicURL)
					response := httptest.NewRecorder()
					s.AuthRouter().ServeHTTP(response, r)
					if response.Code != tc.want {
						t.Fatalf("status=%d want=%d body=%s", response.Code, tc.want, response.Body)
					}
					var count int
					if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM oauth_authorization_codes WHERE authorization_request_id=$1", request.ID).Scan(&count); err != nil {
						t.Fatal(err)
					}
					if tc.want != http.StatusOK {
						if count != 0 {
							t.Fatal("未经确认签发了授权码")
						}
						return
					}
					var launch struct {
						URL string `json:"launch_url"`
					}
					if err := json.Unmarshal(response.Body.Bytes(), &launch); err != nil {
						t.Fatal(err)
					}
					callback, err := url.Parse(launch.URL)
					if err != nil || count != 1 || callback.Query().Get("code") == "" || callback.Query().Get("state") != request.State {
						t.Fatalf("未正确返回一次性授权码: url=%s count=%d err=%v", launch.URL, count, err)
					}
				})
			}
		})
	}
}

func TestAuthorizationCodeProtections(t *testing.T) {
	pool := emailDatabase(t)
	s := NewService(pool, nil, "https://ai.example.com")
	user := grantUser(t, s)
	for _, tc := range []string{"wrong verifier", "wrong redirect", "expired code", "replayed code", "expired request", "replayed request"} {
		t.Run(tc, func(t *testing.T) {
			request, verifier := grantRequest(t, s, "session:read")
			if tc == "expired request" {
				if _, err := pool.Exec(t.Context(), "UPDATE oauth_authorization_requests SET created_at=now()-interval '1 hour', expires_at=now()-interval '1 second' WHERE id=$1", request.ID); err != nil {
					t.Fatal(err)
				}
			}
			approval := request.Scopes
			launch, err := s.completeAuthorization(t.Context(), request.ID, user.ID, &approval)
			if tc == "expired request" {
				if err == nil {
					t.Fatal("过期请求不应完成")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if tc == "replayed request" {
				if _, err := s.completeAuthorization(t.Context(), request.ID, user.ID, &approval); err == nil {
					t.Fatal("请求不能重复完成")
				}
				return
			}
			callback, err := url.Parse(launch)
			if err != nil {
				t.Fatal(err)
			}
			code := callback.Query().Get("code")
			redirect, candidate := request.RedirectURI, verifier
			switch tc {
			case "wrong verifier":
				candidate = strings.Repeat("w", 64)
			case "wrong redirect":
				redirect = "http://127.0.0.1:54321/oauth/callback"
			case "expired code":
				if _, err := pool.Exec(t.Context(), "UPDATE oauth_authorization_codes SET created_at=now()-interval '1 hour', expires_at=now()-interval '1 second' WHERE authorization_request_id=$1", request.ID); err != nil {
					t.Fatal(err)
				}
			case "replayed code":
				token, err := s.ExchangeCode(t.Context(), request.ClientID, redirect, code, candidate)
				if err != nil || token.Scope != "session:read" || token.GrantID == "" {
					t.Fatalf("正常兑换失败: %+v %v", token, err)
				}
			}
			_, err = s.ExchangeCode(t.Context(), request.ClientID, redirect, code, candidate)
			var protocol protocolError
			if !errors.As(err, &protocol) || protocol.Code != "invalid_grant" {
				t.Fatalf("应拒绝无效授权码: %v", err)
			}
			if tc == "wrong verifier" || tc == "wrong redirect" {
				if _, err := s.ExchangeCode(t.Context(), request.ClientID, request.RedirectURI, code, verifier); err != nil {
					t.Fatalf("错误兑换不应消耗授权码: %v", err)
				}
			}
		})
	}
}

func TestStoredUnsafeRedirectCannotCompleteOrExchange(t *testing.T) {
	pool := emailDatabase(t)
	s := NewService(pool, nil, "https://ai.example.com")
	user := grantUser(t, s)
	request, verifier := grantRequest(t, s, "session:read")
	request.RedirectURI = "https://review.invalid/callback"
	if _, err := pool.Exec(t.Context(), "UPDATE oauth_authorization_requests SET redirect_uri=$2 WHERE id=$1", request.ID, request.RedirectURI); err != nil {
		t.Fatal(err)
	}
	approval := request.Scopes
	if _, err := s.completeAuthorization(t.Context(), request.ID, user.ID, &approval); err == nil {
		t.Fatal("修复前保存的非法回调请求不应完成")
	}
	var count int
	if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM oauth_authorization_codes").Scan(&count); err != nil || count != 0 {
		t.Fatalf("拒绝后不应签发授权码: count=%d err=%v", count, err)
	}
	// 模拟修复前已签发、尚未兑换的授权码。
	const code = "previously-issued-code"
	if err := s.storeAuthorizationCode(t.Context(), request, user.ID, tokenHash(code), s.now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	_, err := s.ExchangeCode(t.Context(), request.ClientID, request.RedirectURI, code, verifier)
	var protocol protocolError
	if !errors.As(err, &protocol) || protocol.Code != "invalid_grant" {
		t.Fatalf("旧非法回调授权码不应兑换: %v", err)
	}
}

func TestAuthorizationScopeInput(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		for _, clientID := range []string{"monkeyai-desktop", "monkeyai-mobile"} {
			s := NewService(nil, nil, "https://ai.example.com")
			if enabled {
				s.WithDeviceAuthorization("server", []byte(strings.Repeat("k", 32)), &deviceRegistryStub{})
			}
			for _, value := range []string{" ", "\t", " \t\r\n ", "\u00a0", "unknown:scope"} {
				values := authorizationValues(clientID, Clients[clientID].RedirectURI)
				values.Set("scope", value)
				_, err := s.BeginAuthorization(t.Context(), values)
				var protocol protocolError
				if !errors.As(err, &protocol) || protocol.Code != "invalid_scope" {
					t.Fatalf("device=%t client=%s scope=%q: %v", enabled, clientID, value, err)
				}
			}
			for _, value := range []string{"omitted", "", "session:read"} {
				values := authorizationValues(clientID, Clients[clientID].RedirectURI)
				if value != "omitted" {
					values.Set("scope", value)
				}
				request, err := s.newAuthorizationRequest(values)
				if err != nil {
					t.Fatal(err)
				}
				var want []string
				if value == "session:read" {
					want = []string{value}
				} else if enabled && clientID == "monkeyai-desktop" {
					want = []string{"device:bind", "device:connect", "device:publish", "session:report"}
				}
				if !slices.Equal(request.Scopes, want) {
					t.Fatalf("device=%t client=%s scope=%q: scopes=%v want=%v", enabled, clientID, value, request.Scopes, want)
				}
			}
		}
	}
}
