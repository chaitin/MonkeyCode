package identity

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/go-chi/chi/v5"
)

func pairingCall(t *testing.T, s *Service, method, path, access string, body any, want int) *httptest.ResponseRecorder {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(method, path, bytes.NewReader(data))
	r.RemoteAddr = "127.0.0.1:1234"
	r.Header.Set("Content-Type", "application/json")
	if access != "" {
		r.Header.Set("Authorization", "Bearer "+access)
	}
	w := httptest.NewRecorder()
	s.OAuthRouter().ServeHTTP(w, r)
	if w.Code != want || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%s %s: status=%d want=%d cache=%q body=%s", method, path, w.Code, want, w.Header().Get("Cache-Control"), w.Body.String())
	}
	return w
}

func pairingCreate(t *testing.T, s *Service, access string) PairingResponse {
	t.Helper()
	w := pairingCall(t, s, "POST", "/pairing", access, struct{}{}, 200)
	var out PairingResponse
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func pairingInput(secret string) (pairingJoin, string) {
	verifier := strings.Repeat("v", 64)
	digest := sha256.Sum256([]byte(verifier))
	return pairingJoin{Secret: secret, Challenge: base64.RawURLEncoding.EncodeToString(digest[:]), Method: "S256", MachineID: uuid.New().String(), Name: "HUAWEI Mate 60", Platform: "harmonyos", OSVersion: "6.0.0", Arch: "arm64-v8a"}, verifier
}

func pairingJoinRequest(t *testing.T, s *Service, request PairingResponse) (pairingJoined, string) {
	t.Helper()
	in, verifier := pairingInput(request.Secret)
	w := pairingCall(t, s, "POST", "/pairing/"+request.ID+"/join", "", in, 200)
	var out pairingJoined
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out, verifier
}

func pairingApprove(t *testing.T, s *Service, access, id, code string, want int) *httptest.ResponseRecorder {
	t.Helper()
	return pairingCall(t, s, "POST", "/pairing/"+id+"/approve", access, map[string]string{"user_code": code}, want)
}

func pairingRow(t *testing.T, s *Service, id string) sqlc.OauthPairingRequest {
	t.Helper()
	row, err := sqlc.New(s.db).PairingByID(t.Context(), id)
	if err != nil {
		t.Fatal(err)
	}
	return row
}

func pairingError(t *testing.T, w *httptest.ResponseRecorder, want string) {
	t.Helper()
	var out struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || out.Error.Code != want {
		t.Fatalf("错误响应=%s want=%s err=%v", w.Body.String(), want, err)
	}
}

func TestPairingFlow(t *testing.T) {
	s, user, _, _ := deviceService(t)
	access := grantToken(t, s, user.ID, "device:manage").AccessToken
	created := pairingCreate(t, s, access)
	if _, err := uuid.Parse(created.ID); err != nil || len(created.Secret) < 40 || created.Expires != 60 {
		t.Fatalf("创建响应无效: %+v %v", created, err)
	}
	payload, err := url.Parse(created.Payload)
	if err != nil || payload.Scheme != "monkeyai-mobile" || payload.Host != "pair" || payload.Path != "/scan" {
		t.Fatalf("二维码地址错误: %s %v", created.Payload, err)
	}
	query := payload.Query()
	if len(query) != 4 || query.Get("v") != "1" || query.Get("server") != s.publicURL || query.Get("id") != created.ID || query.Get("secret") != created.Secret {
		t.Fatal("二维码参数错误")
	}
	pending := pairingCall(t, s, "GET", "/pairing/"+created.ID, access, nil, 200)
	if strings.Contains(pending.Body.String(), "device") {
		t.Fatal("未加入时不应返回设备")
	}
	joined, verifier := pairingJoinRequest(t, s, created)
	if canonical, ok := canonicalUserCode(joined.UserCode); !ok || len(canonical) != 8 || len(joined.UserCode) != 9 || joined.UserCode[4] != '-' || len(joined.DeviceCode) < 40 || joined.Expires != 60 || joined.Interval != 5 {
		t.Fatalf("加入响应无效: %+v", joined)
	}
	row := pairingRow(t, s, created.ID)
	code, _ := canonicalUserCode(joined.UserCode)
	if row.SecretHash != tokenHash(created.Secret) || row.DeviceCodeHash == nil || *row.DeviceCodeHash != tokenHash(joined.DeviceCode) || row.UserCodeHash == nil || *row.UserCodeHash != s.userCodeHash(code) {
		t.Fatal("配对敏感值未正确散列")
	}
	view := pairingCall(t, s, "GET", "/pairing/"+created.ID, access, nil, 200)
	var out map[string]any
	if err := json.Unmarshal(view.Body.Bytes(), &out); err != nil || out["status"] != "joined" || out["device"].(map[string]any)["display_name"] != "HUAWEI Mate 60" {
		t.Fatalf("查询响应错误: %s %v", view.Body.String(), err)
	}
	for _, secret := range []string{"secret", "device_code", "user_code", created.Secret, joined.DeviceCode, joined.UserCode} {
		if strings.Contains(view.Body.String(), secret) {
			t.Fatalf("查询泄露敏感值 %s", secret)
		}
	}
	pairingApprove(t, s, access, created.ID, strings.ToLower(strings.ReplaceAll(joined.UserCode, "-", " ")), 200)
	var audited bool
	if err := s.db.QueryRow(t.Context(), `SELECT EXISTS(SELECT 1 FROM audits WHERE action='pairing.approved' AND target_id=$1 AND actor_user_id=$2 AND request_params->>'pairing_id'=$1::text AND request_params->>'platform'='harmonyos' AND request_params->>'display_name'='HUAWEI Mate 60')`, created.ID, user.ID).Scan(&audited); err != nil || !audited {
		t.Fatalf("批准审计缺失: %v", err)
	}
	form := url.Values{"grant_type": {PairingGrantType}, "client_id": {"monkeyai-mobile"}, "device_code": {joined.DeviceCode}, "code_verifier": {verifier}}
	r := httptest.NewRequest("POST", "/token", strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	s.OAuthRouter().ServeHTTP(w, r)
	var token Token
	if err := json.Unmarshal(w.Body.Bytes(), &token); err != nil || w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("兑换失败: %s %v", w.Body.String(), err)
	}
	wantScopes := []string{"device:connect", "files:read", "files:write", "resources:manage", "session:control", "session:read"}
	if token.AccessToken == "" || token.RefreshToken == "" || token.TokenType != "Bearer" || token.GrantID == "" || token.ExpiresIn != 3600 || !slices.Equal(strings.Fields(token.Scope), wantScopes) || token.MachineID != "" {
		t.Fatalf("手机凭据错误: %+v", token)
	}
	var endpoints int
	if err := s.db.QueryRow(t.Context(), "SELECT count(*) FROM endpoints").Scan(&endpoints); err != nil || endpoints != 0 {
		t.Fatalf("手机配对不应登记执行设备: %d %v", endpoints, err)
	}
	principal := tokenPrincipal(t, s, token.AccessToken, http.StatusNoContent)
	if principal.ClientID != "monkeyai-mobile" || principal.Purpose != "user" || principal.UserID != user.ID || principal.MachineID != "" || !slices.Equal(principal.Scopes, wantScopes) {
		t.Fatalf("手机登录态不兼容账号授权: %+v", principal)
	}
	if row := pairingRow(t, s, created.ID); row.Status != "consumed" {
		t.Fatal("兑换未消费配对")
	}
	_, err = s.ExchangePairingCode(t.Context(), "monkeyai-mobile", joined.DeviceCode, verifier)
	oauthCode(t, err, "invalid_grant")
	refreshed, err := s.Refresh(t.Context(), "monkeyai-mobile", token.RefreshToken)
	if err != nil || refreshed.GrantID != token.GrantID || refreshed.Scope != token.Scope {
		t.Fatalf("配对登录态不能按现有流程刷新: %v", err)
	}
}

func TestPairingAuthorizationAndAvailability(t *testing.T) {
	s, user, _, _ := deviceService(t)
	access := grantToken(t, s, user.ID, "device:manage").AccessToken
	limited := grantToken(t, s, user.ID, "session:read").AccessToken
	pairingCall(t, s, "POST", "/pairing", "", struct{}{}, 401)
	pairingCall(t, s, "POST", "/pairing", limited, struct{}{}, 403)
	pairingCall(t, s, "POST", "/pairing", access, map[string]string{"server": "https://attacker.example"}, 400)
	pairingCall(t, s, "POST", "/pairing", access, nil, 400)
	created := pairingCreate(t, s, access)
	other, err := s.insertUser(t.Context(), "其他用户", "other@example.com", "user", "")
	if err != nil {
		t.Fatal(err)
	}
	otherAccess := grantToken(t, s, other.ID, "device:manage").AccessToken
	pairingCall(t, s, "GET", "/pairing/"+created.ID, otherAccess, nil, 404)
	joined, _ := pairingJoinRequest(t, s, created)
	pairingApprove(t, s, otherAccess, created.ID, joined.UserCode, 404)
	pairingApprove(t, s, limited, created.ID, joined.UserCode, 403)
	pairingCall(t, s, "GET", "/pairing/not-a-uuid", access, nil, 404)
	s.device = nil
	pairingError(t, pairingCall(t, s, "POST", "/pairing", access, struct{}{}, 404), "pairing_unavailable")
}

func TestPairingJoinValidationAndSingleUse(t *testing.T) {
	s, user, _, _ := deviceService(t)
	access := grantToken(t, s, user.ID, "device:manage").AccessToken
	created := pairingCreate(t, s, access)
	in, _ := pairingInput(created.Secret)
	in.Secret = "wrong"
	wrong := pairingCall(t, s, "POST", "/pairing/"+created.ID+"/join", "", in, 404)
	missing := pairingCall(t, s, "POST", "/pairing/"+uuid.New().String()+"/join", "", in, 404)
	if wrong.Body.String() != missing.Body.String() {
		t.Fatal("secret 错误与不存在响应应一致")
	}
	for _, tc := range []struct {
		name string
		edit func(*pairingJoin)
	}{
		{"method", func(in *pairingJoin) { in.Method = "plain" }},
		{"challenge", func(in *pairingJoin) { in.Challenge = "invalid" }},
		{"machine", func(in *pairingJoin) { in.MachineID = "invalid" }},
		{"name", func(in *pairingJoin) { in.Name = strings.Repeat("名", 43) }},
		{"control", func(in *pairingJoin) { in.Name = "device\n" }},
		{"platform", func(in *pairingJoin) { in.Platform = "linux" }},
		{"version", func(in *pairingJoin) { in.OSVersion = strings.Repeat("a", 65) }},
		{"arch", func(in *pairingJoin) { in.Arch = "" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in, _ := pairingInput(created.Secret)
			tc.edit(&in)
			pairingError(t, pairingCall(t, s, "POST", "/pairing/"+created.ID+"/join", "", in, 400), "invalid_request")
		})
	}
	in, _ = pairingInput(created.Secret)
	data, _ := json.Marshal(in)
	for _, body := range []string{strings.TrimSuffix(string(data), "}") + `,"unknown":true}`, string(data) + `{}`, strings.Repeat(" ", 16<<10) + string(data)} {
		r := httptest.NewRequest("POST", "/pairing/"+created.ID+"/join", strings.NewReader(body))
		w := httptest.NewRecorder()
		s.OAuthRouter().ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("未拒绝无效 JSON 或超长正文: %d", w.Code)
		}
	}
	pairingJoinRequest(t, s, created)
	pairingError(t, pairingCall(t, s, "POST", "/pairing/"+created.ID+"/join", "", in, 409), "pairing_already_joined")
	in.Secret = "wrong"
	pairingError(t, pairingCall(t, s, "POST", "/pairing/"+created.ID+"/join", "", in, 404), "pairing_not_found")
}

func TestPairingJoinExpiryWindows(t *testing.T) {
	s, user, _, _ := deviceService(t)
	now := s.now().Truncate(time.Microsecond)
	s.now = func() time.Time { return now }
	access := grantToken(t, s, user.ID, "device:manage").AccessToken
	created := pairingCreate(t, s, access)
	started := now
	now = now.Add(50 * time.Second)
	pairingJoinRequest(t, s, created)
	row := pairingRow(t, s, created.ID)
	if row.ExpiresAt.Sub(now.Add(PairingTTL)).Abs() > time.Millisecond || row.ExpiresAt.After(started.Add(PairingMaxTTL)) {
		t.Fatalf("加入后窗口错误: %v", row.ExpiresAt)
	}
	expired := pairingCreate(t, s, access)
	now = now.Add(PairingTTL)
	in, _ := pairingInput(expired.Secret)
	pairingError(t, pairingCall(t, s, "POST", "/pairing/"+expired.ID+"/join", "", in, 404), "pairing_not_found")
	view := pairingCall(t, s, "GET", "/pairing/"+expired.ID, access, nil, 200)
	if !strings.Contains(view.Body.String(), `"status":"expired"`) {
		t.Fatal("查询未反映实际过期状态")
	}
	capped := pairingCreate(t, s, access)
	if _, err := s.db.Exec(t.Context(), "UPDATE oauth_pairing_requests SET created_at=$2 WHERE id=$1", capped.ID, now.Add(-150*time.Second)); err != nil {
		t.Fatal(err)
	}
	joined, _ := pairingJoinRequest(t, s, capped)
	if joined.Expires != 30 || pairingRow(t, s, capped.ID).ExpiresAt.After(now.Add(30*time.Second)) {
		t.Fatal("加入未遵守创建后 180 秒硬上限")
	}
}

func TestPairingApprovalFailuresAndExpiry(t *testing.T) {
	s, user, _, _ := deviceService(t)
	access := grantToken(t, s, user.ID, "device:manage").AccessToken
	created := pairingCreate(t, s, access)
	pairingError(t, pairingApprove(t, s, access, created.ID, "ABCDEFGH", 409), "pairing_resolved")
	joined, verifier := pairingJoinRequest(t, s, created)
	wrongCode := "AAAA-AAAA"
	if wrongCode == joined.UserCode {
		wrongCode = "BBBB-BBBB"
	}
	for i := 1; i <= PairingMaxFailed; i++ {
		code := wrongCode
		if i == 1 {
			code = "invalid"
		}
		pairingError(t, pairingApprove(t, s, access, created.ID, code, 400), "invalid_user_code")
		row := pairingRow(t, s, created.ID)
		if row.FailedAttempts != int32(i) || i == PairingMaxFailed && row.Status != "denied" {
			t.Fatalf("失败次数或锁定状态错误: %+v", row)
		}
	}
	pairingError(t, pairingApprove(t, s, access, created.ID, joined.UserCode, 409), "pairing_resolved")
	_, err := s.ExchangePairingCode(t.Context(), "monkeyai-mobile", joined.DeviceCode, verifier)
	oauthCode(t, err, "access_denied")
	expired := pairingCreate(t, s, access)
	expiredJoin, expiredVerifier := pairingJoinRequest(t, s, expired)
	now := s.now().Add(61 * time.Second)
	s.now = func() time.Time { return now }
	pairingError(t, pairingApprove(t, s, access, expired.ID, expiredJoin.UserCode, 409), "pairing_expired")
	_, err = s.ExchangePairingCode(t.Context(), "monkeyai-mobile", expiredJoin.DeviceCode, expiredVerifier)
	oauthCode(t, err, "expired_token")
}

func TestPairingPollingPKCEAndClient(t *testing.T) {
	s, user, _, _ := deviceService(t)
	now := s.now()
	s.now = func() time.Time { return now }
	access := grantToken(t, s, user.ID, "device:manage").AccessToken
	created := pairingCreate(t, s, access)
	joined, verifier := pairingJoinRequest(t, s, created)
	for _, client := range []string{"", "monkeyai-desktop", RuntimeClientID} {
		_, err := s.ExchangePairingCode(t.Context(), client, joined.DeviceCode, verifier)
		oauthCode(t, err, "invalid_client")
	}
	_, err := s.ExchangePairingCode(t.Context(), "monkeyai-mobile", "unknown", verifier)
	oauthCode(t, err, "invalid_grant")
	_, err = s.ExchangePairingCode(t.Context(), "monkeyai-mobile", joined.DeviceCode, "short")
	oauthCode(t, err, "invalid_grant")
	_, err = s.ExchangePairingCode(t.Context(), "monkeyai-mobile", joined.DeviceCode, verifier)
	oauthCode(t, err, "authorization_pending")
	for _, interval := range []int64{10000, 15000} {
		_, err = s.ExchangePairingCode(t.Context(), "monkeyai-mobile", joined.DeviceCode, verifier)
		oauthCode(t, err, "slow_down")
		if row := pairingRow(t, s, created.ID); row.IntervalMs != interval || row.NextPollAt.Sub(now.Add(time.Duration(interval)*time.Millisecond)).Abs() > time.Millisecond {
			t.Fatalf("轮询退避未持久化: %+v", row)
		}
	}
	pairingApprove(t, s, access, created.ID, joined.UserCode, 200)
	now = now.Add(15 * time.Second)
	_, err = s.ExchangePairingCode(t.Context(), "monkeyai-mobile", joined.DeviceCode, strings.Repeat("w", 64))
	oauthCode(t, err, "invalid_grant")
	if row := pairingRow(t, s, created.ID); row.Status != "approved" {
		t.Fatal("错误 PKCE 消费了配对")
	}
	now = now.Add(15 * time.Second)
	if _, err := s.ExchangePairingCode(t.Context(), "monkeyai-mobile", joined.DeviceCode, verifier); err != nil {
		t.Fatalf("正确 PKCE 不能兑换: %v", err)
	}
	consumedAt := now
	now = now.Add(2 * time.Minute)
	_, err = s.ExchangePairingCode(t.Context(), "monkeyai-mobile", joined.DeviceCode, verifier)
	oauthCode(t, err, "invalid_grant")
	now = consumedAt
	expired := pairingCreate(t, s, access)
	expiredJoin, v := pairingJoinRequest(t, s, expired)
	now = now.Add(61 * time.Second)
	_, err = s.ExchangePairingCode(t.Context(), "monkeyai-mobile", expiredJoin.DeviceCode, v)
	oauthCode(t, err, "expired_token")
	if pairingRow(t, s, expired.ID).Status != "expired" {
		t.Fatal("兑换超时未保存 expired")
	}
}

func pairingPasswordChange(t *testing.T, s *Service, cookie *http.Cookie) {
	t.Helper()
	r := httptest.NewRequest("POST", "/profile/password", strings.NewReader(`{"current_password":"current-password-123","new_password":"changed-password-456"}`))
	r.AddCookie(cookie)
	r.Header.Set("Origin", s.publicURL)
	r.Header.Set("X-CSRF-Token", consentToken(r, profileCSRF))
	w := httptest.NewRecorder()
	s.AuthRouter().ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("修改密码失败: %d %s", w.Code, w.Body.String())
	}
}

func TestPairingPasswordChangeRevokesAllStates(t *testing.T) {
	s, user, cookie, _ := deviceService(t)
	hash, err := hashPassword("current-password-123")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sqlc.New(s.db).SetProfilePassword(t.Context(), sqlc.SetProfilePasswordParams{ID: user.ID, PasswordHash: new(hash)}); err != nil {
		t.Fatal(err)
	}
	access := grantToken(t, s, user.ID, "device:manage").AccessToken
	pending := pairingCreate(t, s, access)
	joined := pairingCreate(t, s, access)
	joinedCodes, verifier := pairingJoinRequest(t, s, joined)
	approved := pairingCreate(t, s, access)
	approvedCodes, _ := pairingJoinRequest(t, s, approved)
	pairingApprove(t, s, access, approved.ID, approvedCodes.UserCode, 200)
	pairingPasswordChange(t, s, cookie)
	for _, id := range []string{pending.ID, joined.ID, approved.ID} {
		if row := pairingRow(t, s, id); row.Status != "denied" {
			t.Fatalf("改密漏撤销 %s: %s", id, row.Status)
		}
	}
	for _, code := range []string{joinedCodes.DeviceCode, approvedCodes.DeviceCode} {
		_, err = s.ExchangePairingCode(t.Context(), "monkeyai-mobile", code, verifier)
		oauthCode(t, err, "access_denied")
	}
	pairingApprove(t, s, access, approved.ID, approvedCodes.UserCode, 401)
	tokenPrincipal(t, s, access, 401)
}

func TestPairingConcurrentApprovalAndExchange(t *testing.T) {
	s, user, _, _ := deviceService(t)
	access := grantToken(t, s, user.ID, "device:manage").AccessToken
	created := pairingCreate(t, s, access)
	joined, verifier := pairingJoinRequest(t, s, created)
	start := make(chan struct{})
	statuses := make(chan int, 2)
	var workers sync.WaitGroup
	for range 2 {
		workers.Go(func() {
			<-start
			body, _ := json.Marshal(map[string]string{"user_code": joined.UserCode})
			r := httptest.NewRequest("POST", "/pairing/"+created.ID+"/approve", bytes.NewReader(body))
			r.Header.Set("Authorization", "Bearer "+access)
			w := httptest.NewRecorder()
			s.OAuthRouter().ServeHTTP(w, r)
			statuses <- w.Code
		})
	}
	close(start)
	workers.Wait()
	first, second := <-statuses, <-statuses
	if !(first == 200 && second == 409 || first == 409 && second == 200) {
		t.Fatalf("并发批准结果错误: %d %d", first, second)
	}
	results := make(chan error, 2)
	for range 2 {
		workers.Go(func() {
			_, err := s.ExchangePairingCode(t.Context(), "monkeyai-mobile", joined.DeviceCode, verifier)
			results <- err
		})
	}
	workers.Wait()
	a, b := <-results, <-results
	if a == nil && b == nil || a != nil && b != nil {
		t.Fatalf("配对必须只兑换一次: %v %v", a, b)
	}
	var grants int
	if err := s.db.QueryRow(t.Context(), "SELECT count(*) FROM oauth_grants WHERE client_id='monkeyai-mobile'").Scan(&grants); err != nil || grants != 1 {
		t.Fatalf("配对重复签发 grant: %d %v", grants, err)
	}
}

func TestPairingExchangeDoesNotWaitForRequestLock(t *testing.T) {
	s, user, _, _ := deviceService(t)
	access := grantToken(t, s, user.ID, "device:manage").AccessToken
	created := pairingCreate(t, s, access)
	joined, verifier := pairingJoinRequest(t, s, created)
	pairingApprove(t, s, access, created.ID, joined.UserCode, 200)
	tx, err := s.db.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackProfile(t.Context(), tx)
	if _, err := sqlc.New(tx).LockPairing(t.Context(), created.ID); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	_, err = s.ExchangePairingCode(ctx, "monkeyai-mobile", joined.DeviceCode, verifier)
	oauthCode(t, err, "authorization_pending")
	if _, err := sqlc.New(tx).LockProfileCredentials(ctx, user.ID); err != nil {
		t.Fatalf("兑换未释放用户锁，可能与改密死锁: %v", err)
	}
	if err := tx.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ExchangePairingCode(t.Context(), "monkeyai-mobile", joined.DeviceCode, verifier); err != nil {
		t.Fatalf("锁释放后不能兑换: %v", err)
	}
}

func TestPairingRejectsPreviouslyAuthenticatedBearer(t *testing.T) {
	s, user, _, _ := deviceService(t)
	access := grantToken(t, s, user.ID, "device:manage").AccessToken
	created := pairingCreate(t, s, access)
	joined, _ := pairingJoinRequest(t, s, created)
	body, _ := json.Marshal(map[string]string{"user_code": joined.UserCode})
	r := httptest.NewRequest("POST", "/pairing/"+created.ID+"/approve", bytes.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+access)
	route := chi.NewRouteContext()
	route.URLParams.Add("pairingID", created.ID)
	r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, route))
	var authenticated *http.Request
	s.RequireAgent(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { authenticated = r })).ServeHTTP(httptest.NewRecorder(), r)
	if authenticated == nil {
		t.Fatal("测试请求未通过初始鉴权")
	}
	if _, err := sqlc.New(s.db).RevokeProfileTokens(t.Context(), user.ID); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	s.approvePairing(w, authenticated)
	if w.Code != 401 || pairingRow(t, s, created.ID).Status != "joined" {
		t.Fatalf("已撤销 Bearer 仍能批准: %d %s", w.Code, w.Body.String())
	}
}

func TestPairingPasswordChangeRacesAuthorization(t *testing.T) {
	for _, operation := range []string{"approve", "exchange"} {
		t.Run(operation, func(t *testing.T) {
			s, user, cookie, _ := deviceService(t)
			hash, err := hashPassword("current-password-123")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := sqlc.New(s.db).SetProfilePassword(t.Context(), sqlc.SetProfilePasswordParams{ID: user.ID, PasswordHash: new(hash)}); err != nil {
				t.Fatal(err)
			}
			access := grantToken(t, s, user.ID, "device:manage").AccessToken
			created := pairingCreate(t, s, access)
			joined, verifier := pairingJoinRequest(t, s, created)
			if operation == "exchange" {
				pairingApprove(t, s, access, created.ID, joined.UserCode, 200)
			}
			start := make(chan struct{})
			password := make(chan *httptest.ResponseRecorder, 1)
			result := make(chan error, 1)
			go func() {
				<-start
				r := httptest.NewRequest("POST", "/profile/password", strings.NewReader(`{"current_password":"current-password-123","new_password":"changed-password-456"}`))
				r.AddCookie(cookie)
				r.Header.Set("Origin", s.publicURL)
				r.Header.Set("X-CSRF-Token", consentToken(r, profileCSRF))
				w := httptest.NewRecorder()
				s.AuthRouter().ServeHTTP(w, r)
				password <- w
			}()
			go func() {
				<-start
				if operation == "exchange" {
					_, err := s.ExchangePairingCode(t.Context(), "monkeyai-mobile", joined.DeviceCode, verifier)
					result <- err
					return
				}
				body, _ := json.Marshal(map[string]string{"user_code": joined.UserCode})
				r := httptest.NewRequest("POST", "/pairing/"+created.ID+"/approve", bytes.NewReader(body))
				r.Header.Set("Authorization", "Bearer "+access)
				w := httptest.NewRecorder()
				s.OAuthRouter().ServeHTTP(w, r)
				if w.Code != 200 && w.Code != 401 && w.Code != 409 {
					result <- errors.New(w.Body.String())
					return
				}
				result <- nil
			}()
			close(start)
			select {
			case w := <-password:
				if w.Code != 200 {
					t.Fatalf("并发改密失败: %d %s", w.Code, w.Body.String())
				}
			case <-time.After(10 * time.Second):
				t.Fatal("并发改密未完成，可能发生死锁")
			}
			err = <-result
			if err != nil {
				var protocol protocolError
				if operation != "exchange" || !errors.As(err, &protocol) || !slices.Contains([]string{"authorization_pending", "access_denied"}, protocol.Code) {
					t.Fatalf("并发授权结果异常: %v", err)
				}
			}
			row := pairingRow(t, s, created.ID)
			if row.Status != "denied" && row.Status != "consumed" {
				t.Fatalf("改密后配对仍可兑换: %s", row.Status)
			}
			var active int
			if err := s.db.QueryRow(t.Context(), "SELECT count(*) FROM oauth_grants WHERE user_id=$1 AND revoked_at IS NULL", user.ID).Scan(&active); err != nil || active != 0 {
				t.Fatalf("改密漏撤销并发签发的授权: %d %v", active, err)
			}
		})
	}
}

func TestPairingPasswordRechecksNewRequests(t *testing.T) {
	for _, state := range []string{"pending", "joined", "approved"} {
		t.Run(state, func(t *testing.T) {
			s, user, _, _ := deviceService(t)
			access := grantToken(t, s, user.ID, "device:manage").AccessToken
			tx, err := s.db.Begin(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			defer rollbackProfile(t.Context(), tx)
			q := sqlc.New(tx)
			if err := q.RevokeProfilePairings(t.Context(), user.ID); err != nil {
				t.Fatal(err)
			}
			created := pairingCreate(t, s, access)
			if state != "pending" {
				joined, _ := pairingJoinRequest(t, s, created)
				if state == "approved" {
					pairingApprove(t, s, access, created.ID, joined.UserCode, 200)
				}
			}
			if _, err := q.LockProfileCredentials(t.Context(), user.ID); err != nil {
				t.Fatal(err)
			}
			active, err := q.HasProfilePairings(t.Context(), user.ID)
			if err != nil || !active {
				t.Fatalf("改密拿锁期间出现的配对未被复查: %s %v", state, err)
			}
		})
	}
}

func TestPairingPendingCodeAndInactiveUser(t *testing.T) {
	s, user, _, _ := deviceService(t)
	access := grantToken(t, s, user.ID, "device:manage").AccessToken
	created := pairingCreate(t, s, access)
	_, verifier := pairingInput(created.Secret)
	if _, err := s.db.Exec(t.Context(), "UPDATE oauth_pairing_requests SET device_code_hash=$2 WHERE id=$1", created.ID, tokenHash("pending-code")); err != nil {
		t.Fatal(err)
	}
	_, err := s.ExchangePairingCode(t.Context(), "monkeyai-mobile", "pending-code", verifier)
	oauthCode(t, err, "authorization_pending")
	if _, err := s.db.Exec(t.Context(), "UPDATE users SET status='disabled' WHERE id=$1", user.ID); err != nil {
		t.Fatal(err)
	}
	_, err = s.ExchangePairingCode(t.Context(), "monkeyai-mobile", "pending-code", verifier)
	oauthCode(t, err, "invalid_grant")
}

func TestPairingAnonymousRateLimitAndMetadata(t *testing.T) {
	s, _, _, _ := deviceService(t)
	in, _ := pairingInput("wrong")
	for range 60 {
		pairingCall(t, s, "POST", "/pairing/"+uuid.New().String()+"/join", "", in, 404)
	}
	w := pairingCall(t, s, "POST", "/pairing/"+uuid.New().String()+"/join", "", in, 429)
	if w.Header().Get("Retry-After") != "60" {
		t.Fatal("匿名限流未返回 Retry-After")
	}
	for _, enabled := range []bool{true, false} {
		if !enabled {
			s.device = nil
		}
		w := httptest.NewRecorder()
		s.OAuthMetadata(w, httptest.NewRequest("GET", "/.well-known/oauth-authorization-server", nil))
		var metadata struct {
			Grants []string `json:"grant_types_supported"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &metadata); err != nil || slices.Contains(metadata.Grants, PairingGrantType) != enabled {
			t.Fatalf("配对 grant 元数据错误: %s %v", w.Body.String(), err)
		}
	}
}
