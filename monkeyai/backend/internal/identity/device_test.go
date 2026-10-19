package identity

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
	"uuid"

	"github.com/jackc/pgx/v5"
)

type deviceRegistryStub struct{ revoked bool }

func (d *deviceRegistryStub) VerifyDeviceRequest(context.Context, pgx.Tx, string, string, []byte) (bool, error) {
	return d.revoked, nil
}
func deviceService(t *testing.T) (*Service, User, *http.Cookie, *deviceRegistryStub) {
	t.Helper()
	return deviceServiceOrigin(t, "https://ai.example.com")
}
func deviceServiceOrigin(t *testing.T, origin string) (*Service, User, *http.Cookie, *deviceRegistryStub) {
	t.Helper()
	pool := emailDatabase(t)
	s := NewService(pool, authenticationStub{json.RawMessage(`{}`)}, origin)
	registry := &deviceRegistryStub{}
	s.WithDeviceAuthorization(uuid.New().String(), bytes.Repeat([]byte{1}, 32), registry)
	user := grantUser(t, s)
	cookie := &http.Cookie{Name: sessionCookie, Value: "device-browser-session"}
	if err := s.createBrowserSession(t.Context(), user.ID, tokenHash(cookie.Value), "password", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	// Docker 数据库与宿主墙钟可能有偏差，轮询测试使用同一时间来源。
	started := time.Now()
	var databaseTime time.Time
	if err := pool.QueryRow(t.Context(), "SELECT clock_timestamp()").Scan(&databaseTime); err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return databaseTime.Add(time.Since(started)) }
	return s, user, cookie, registry
}
func deviceApplication(t *testing.T, s *Service) DeviceResponse {
	t.Helper()
	public, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	form := url.Values{"client_id": {RuntimeClientID}, "machine_id": {uuid.New().String()}, "execution_public_key": {base64.RawURLEncoding.EncodeToString(public)}, "display_name": {"独立服务器"}, "platform": {"linux"}, "arch": {"amd64"}}
	req := httptest.NewRequest("POST", "/device/authorization", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response := httptest.NewRecorder()
	s.OAuthRouter().ServeHTTP(response, req)
	if response.Code != 200 {
		t.Fatalf("申请状态=%d body=%s", response.Code, response.Body.String())
	}
	var out DeviceResponse
	if err = json.Unmarshal(response.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}
func deviceView(t *testing.T, s *Service, response DeviceResponse, cookie *http.Cookie) map[string]any {
	t.Helper()
	req := httptest.NewRequest("GET", "/client-requests/device?purpose=device&user_code="+url.QueryEscape(response.UserCode), nil)
	req.AddCookie(cookie)
	out := httptest.NewRecorder()
	s.AuthRouter().ServeHTTP(out, req)
	if out.Code != 200 {
		t.Fatalf("确认页状态=%d body=%s", out.Code, out.Body.String())
	}
	var value map[string]any
	if json.Unmarshal(out.Body.Bytes(), &value) != nil {
		t.Fatal("确认响应无效")
	}
	if strings.Contains(out.Body.String(), response.DeviceCode) {
		t.Fatal("确认页泄露 device_code")
	}
	return value
}
func deviceDecide(t *testing.T, s *Service, view map[string]any, cookie *http.Cookie, decision string, scopes []string, restore bool, csrf string, want int) {
	t.Helper()
	body, _ := json.Marshal(deviceDecision{RequestID: view["request_id"].(string), Decision: decision, Scopes: &scopes, RestoreRevoked: restore})
	req := httptest.NewRequest("POST", "/device/decision", bytes.NewReader(body))
	req.AddCookie(cookie)
	req.Header.Set("X-CSRF-Token", csrf)
	req.Header.Set("Origin", s.publicURL)
	response := httptest.NewRecorder()
	s.AuthRouter().ServeHTTP(response, req)
	if response.Code != want {
		t.Fatalf("批准状态=%d want=%d body=%s", response.Code, want, response.Body.String())
	}
}
func oauthCode(t *testing.T, err error, want string) {
	t.Helper()
	var protocol protocolError
	if !errors.As(err, &protocol) || protocol.Code != want {
		t.Fatalf("OAuth 错误=%v want=%s", err, want)
	}
}
func TestDeviceGrantHTTPAuthorization(t *testing.T) {
	for _, origin := range []string{"http://203.0.113.20:8080", "http://192.168.1.20:8080"} {
		t.Run(origin, func(t *testing.T) {
			s, _, cookie, _ := deviceServiceOrigin(t, origin)
			response := deviceApplication(t, s)
			if response.VerificationURI != origin+"/device" || !strings.HasPrefix(response.VerificationURIComplete, origin+"/device?") {
				t.Fatal("设备授权未返回配置的 HTTP 验证地址")
			}
			view := deviceView(t, s, response, cookie)
			scopes := []string{"device:bind", "device:publish", "session:report"}
			deviceDecide(t, s, view, cookie, "approve", scopes, false, view["csrf_token"].(string), 200)
			token, err := s.ExchangeDeviceCode(t.Context(), RuntimeClientID, response.DeviceCode)
			if err != nil || token.ServerID == "" || token.MachineID != view["machine_id"] {
				t.Fatalf("HTTP 部署批准后无法兑换设备凭据: %v", err)
			}
		})
	}
}

func TestDeviceGrantPollingConsentAndBinding(t *testing.T) {
	s, _, cookie, _ := deviceService(t)
	response := deviceApplication(t, s)
	view := deviceView(t, s, response, cookie)
	var stored string
	if err := s.db.QueryRow(t.Context(), "SELECT device_code_hash FROM oauth_device_requests WHERE id=$1", view["request_id"]).Scan(&stored); err != nil || stored == response.DeviceCode {
		t.Fatal("设备码未散列")
	}
	_, err := s.ExchangeDeviceCode(t.Context(), RuntimeClientID, response.DeviceCode)
	oauthCode(t, err, "authorization_pending")
	_, err = s.ExchangeDeviceCode(t.Context(), RuntimeClientID, response.DeviceCode)
	oauthCode(t, err, "slow_down")
	approved := []string{"device:bind", "session:report"}
	deviceDecide(t, s, view, cookie, "approve", approved, false, "invalid", 403)
	deviceDecide(t, s, view, cookie, "approve", []string{"device:connect"}, false, view["csrf_token"].(string), 400)
	deviceDecide(t, s, view, cookie, "approve", approved, false, view["csrf_token"].(string), 200)
	if _, err = s.db.Exec(t.Context(), "UPDATE oauth_device_requests SET next_poll_at=now()-interval '1 second' WHERE id=$1", view["request_id"]); err != nil {
		t.Fatal(err)
	}
	token, err := s.ExchangeDeviceCode(t.Context(), RuntimeClientID, response.DeviceCode)
	if err != nil {
		t.Fatal(err)
	}
	if token.ServerID == "" || token.MachineID != view["machine_id"] || token.Scope != "device:bind session:report" {
		t.Fatal("兑换未保留冻结身份和批准范围")
	}
	p := tokenPrincipal(t, s, token.AccessToken, http.StatusNoContent)
	if p.Purpose != "runtime" || p.MachineID != "" || p.Has("device:connect") {
		t.Fatal("待证明执行授权不应取得可信宿主或控制权限")
	}
	tx, err := s.db.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.BindDevice(t.Context(), tx, p, uuid.New().String(), view["key_fingerprint"].(string)); !errors.Is(err, ErrDeviceBindingConflict) {
		t.Fatal("专用授权可以改绑另一机器")
	}
	tx.Rollback(t.Context())
	tx, err = s.db.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	valid, err := s.BindDevice(t.Context(), tx, p, token.MachineID, view["key_fingerprint"].(string))
	if err != nil || !valid {
		t.Fatalf("固定设备绑定失败：%v", err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	p = tokenPrincipal(t, s, token.AccessToken, http.StatusNoContent)
	if p.MachineID != token.MachineID {
		t.Fatal("证明后宿主未绑定")
	}
	_, err = s.Refresh(t.Context(), "monkeyai-desktop", token.RefreshToken)
	oauthCode(t, err, "invalid_grant")
	refreshed, err := s.Refresh(t.Context(), RuntimeClientID, token.RefreshToken)
	if err != nil || refreshed.GrantID != token.GrantID || refreshed.MachineID != token.MachineID {
		t.Fatalf("runtime 刷新丢失 client 或宿主：%v", err)
	}
	_, err = s.ExchangeDeviceCode(t.Context(), RuntimeClientID, response.DeviceCode)
	oauthCode(t, err, "invalid_grant")
	deviceDecide(t, s, view, cookie, "deny", nil, false, view["csrf_token"].(string), 409)
}
func TestDeviceGrantDenialExpiryAndRestore(t *testing.T) {
	s, _, cookie, registry := deviceService(t)
	denied := deviceApplication(t, s)
	view := deviceView(t, s, denied, cookie)
	deviceDecide(t, s, view, cookie, "deny", nil, false, view["csrf_token"].(string), 200)
	_, err := s.ExchangeDeviceCode(t.Context(), RuntimeClientID, denied.DeviceCode)
	oauthCode(t, err, "access_denied")
	expired := deviceApplication(t, s)
	if _, err = s.db.Exec(t.Context(), "UPDATE oauth_device_requests SET created_at=now()-interval '11 minutes',expires_at=now()-interval '1 second' WHERE device_code_hash=$1", tokenHash(expired.DeviceCode)); err != nil {
		t.Fatal(err)
	}
	_, err = s.ExchangeDeviceCode(t.Context(), RuntimeClientID, expired.DeviceCode)
	oauthCode(t, err, "expired_token")
	registry.revoked = true
	restore := deviceApplication(t, s)
	view = deviceView(t, s, restore, cookie)
	if view["requires_restore"] != true {
		t.Fatal("没有展示恢复设备影响")
	}
	deviceDecide(t, s, view, cookie, "approve", runtimeScopes, false, view["csrf_token"].(string), 409)
	deviceDecide(t, s, view, cookie, "approve", runtimeScopes, true, view["csrf_token"].(string), 200)
	token, err := s.ExchangeDeviceCode(t.Context(), RuntimeClientID, restore.DeviceCode)
	if err != nil {
		t.Fatal(err)
	}
	var approved bool
	if err = s.db.QueryRow(t.Context(), "SELECT restore_approved FROM oauth_grants WHERE id=$1", token.GrantID).Scan(&approved); err != nil || !approved {
		t.Fatal("恢复批准未保存")
	}
}
func TestDeviceGrantConcurrentExchangeIsConsumedOnce(t *testing.T) {
	s, _, cookie, _ := deviceService(t)
	response := deviceApplication(t, s)
	view := deviceView(t, s, response, cookie)
	deviceDecide(t, s, view, cookie, "approve", runtimeScopes, false, view["csrf_token"].(string), 200)
	var workers sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		workers.Go(func() {
			_, err := s.ExchangeDeviceCode(t.Context(), RuntimeClientID, response.DeviceCode)
			results <- err
		})
	}
	workers.Wait()
	first, second := <-results, <-results
	if first == nil && second == nil || first != nil && second != nil {
		t.Fatalf("并发兑换结果异常：%v %v", first, second)
	}
	var grants int
	if err := s.db.QueryRow(t.Context(), "SELECT count(*) FROM oauth_grants WHERE purpose='runtime'").Scan(&grants); err != nil || grants != 1 {
		t.Fatal("设备授权重复签发")
	}
}
func TestDeviceSSOStateDoesNotReuseAuthorizationRequest(t *testing.T) {
	s, _, cookie, _ := deviceService(t)
	response := deviceApplication(t, s)
	view := deviceView(t, s, response, cookie)
	requestID := view["request_id"].(string)
	if err := s.createLoginState(t.Context(), tokenHash("device-sso-state"), "oidc", requestID, loginPurposeDevice, time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	state, err := s.consumeLoginState(t.Context(), tokenHash("device-sso-state"))
	if err != nil {
		t.Fatal(err)
	}
	if state.Purpose != loginPurposeDevice || state.DeviceRequestID != requestID || state.AuthorizationRequestID != "" {
		t.Fatal("设备登录复用了授权码请求标识")
	}
	if got := s.upstreamResultURL(state, ""); got != "https://ai.example.com/device?request_id="+requestID {
		t.Fatal("SSO 没有返回同一个设备申请")
	}
	if _, err := s.consumeLoginState(t.Context(), tokenHash("device-sso-state")); err == nil {
		t.Fatal("SSO state 被重复消费")
	}
}

func TestRuntimeRoutesCannotManageOtherDevices(t *testing.T) {
	p := Principal{Purpose: "runtime", MachineID: uuid.New().String(), Scopes: runtimeScopes, Audience: Audience}
	for _, path := range []string{"/api/v1/endpoints/other/connections", "/api/v1/users", "/api/v1/sessions", "/api/v1/models"} {
		if runtimeRoute(p, "POST", path) {
			t.Fatalf("执行授权放行管理入口 %s", path)
		}
	}
	if !runtimeRoute(p, "GET", "/api/v1/me") || !runtimeRoute(p, "GET", "/api/v1/endpoint-bridge") {
		t.Fatal("执行授权自身入口不可用")
	}
}
