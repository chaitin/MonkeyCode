package identity

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/member"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type seatWriter struct{ createWriter }

func (w *seatWriter) UpdateUser(context.Context, pgx.Tx, member.UpdateUser) (member.User, error) {
	return member.User{}, w.err
}

func (w *seatWriter) RegisterEmailUser(context.Context, pgx.Tx, string) (member.User, error) {
	return member.User{}, w.err
}

func (w *seatWriter) UpsertIdentity(context.Context, member.OAuthIdentity) (member.User, error) {
	return member.User{}, w.err
}

var seatErrorCases = []struct {
	name    string
	err     error
	status  int
	code    string
	message string
}{
	{"席位不足", member.ErrSeatsExceeded, http.StatusConflict, "seats_exceeded", "席位不足，请联系管理员导入有效 License 或增加授权席位。"},
	{"包装席位错误", fmt.Errorf("创建失败: %w", member.ErrSeatsExceeded), http.StatusConflict, "seats_exceeded", "席位不足，请联系管理员导入有效 License 或增加授权席位。"},
	{"授权不可用", fmt.Errorf("%w: 内部授权详情", member.ErrSeatsUnavailable), http.StatusServiceUnavailable, "seats_unavailable", "席位授权不可用，请联系管理员导入有效 License。"},
	{"写入未接入", member.ErrWriterUnavailable, http.StatusServiceUnavailable, "member_writer_unavailable", "成员写入能力不可用"},
}

func TestSeatErrorsAcrossUserEndpoints(t *testing.T) {
	for _, tc := range seatErrorCases {
		for _, entry := range []string{"创建成员", "创建管理员", "重新启用", "邮箱注册"} {
			t.Run(tc.name+"/"+entry, func(t *testing.T) {
				pool := emailDatabase(t)
				sender := &mailStub{}
				service := NewService(pool, authenticationStub{json.RawMessage(`{"email_code_enabled":true,"email_code_auto_registration_enabled":true}`)}, "http://localhost").
					WithUserWriter(&seatWriter{createWriter{err: tc.err}}).WithEmailSender(sender)
				recorder := httptest.NewRecorder()
				switch entry {
				case "创建成员", "创建管理员":
					role := "user"
					if entry == "创建管理员" {
						role = "admin"
					}
					request := httptest.NewRequest(http.MethodPost, "/users", strings.NewReader(fmt.Sprintf(`{"name":"测试成员","email":"new@example.com","role":%q,"password":"long-password-123"}`, role)))
					service.createUser(recorder, request)
				case "重新启用":
					router := chi.NewRouter()
					service.RegisterAdmin(router)
					request := httptest.NewRequest(http.MethodPatch, "/users/member-id", strings.NewReader(`{"name":"测试成员","role":"user","status":"active"}`))
					router.ServeHTTP(recorder, request)
				case "邮箱注册":
					authCall(t, service, "/email/code", emailInput{Email: "new@example.com", Purpose: "login"}, http.StatusOK)
					input := emailInput{Email: "new@example.com", Code: sender.code}
					recorder = authCall(t, service, "/email/login", input, tc.status)
					// 创建失败须回滚验证码消费，用户扩容后仍可重试。
					authCall(t, service, "/email/login", input, tc.status)
				}
				var payload struct {
					Error struct {
						Code    string `json:"code"`
						Message string `json:"message"`
					} `json:"error"`
				}
				if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
					t.Fatal(err)
				}
				if recorder.Code != tc.status || payload.Error.Code != tc.code || payload.Error.Message != tc.message {
					t.Fatalf("响应=%d %s", recorder.Code, recorder.Body.String())
				}
				if len(recorder.Result().Cookies()) != 0 {
					t.Fatal("席位不足时不得创建登录会话")
				}
				var count int
				if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM users").Scan(&count); err != nil || count != 0 {
					t.Fatalf("注册失败后不应留下用户: count=%d err=%v", count, err)
				}
			})
		}
	}
}

func TestOAuthSeatErrorRedirects(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			writeJSON(w, http.StatusOK, map[string]string{"access_token": "upstream-token"})
		case "/userinfo":
			writeJSON(w, http.StatusOK, map[string]string{"sub": "new-user", "email": "new@example.com", "name": "测试成员"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	settings, err := json.Marshal(authenticationSettings{OAuthConnections: []OAuthConnection{{
		ID: "oidc", Provider: "oidc", Enabled: true, IssuerURL: upstream.URL,
		AuthorizationURL: upstream.URL + "/authorize", TokenURL: upstream.URL + "/token", UserInfoURL: upstream.URL + "/userinfo",
	}}})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range seatErrorCases {
		for _, purpose := range []string{loginPurposeAdmin, loginPurposeClient} {
			t.Run(tc.name+"/"+purpose, func(t *testing.T) {
				pool := emailDatabase(t)
				service := NewService(pool, authenticationStub{settings}, "http://localhost").WithUserWriter(&seatWriter{createWriter{err: tc.err}})
				requestID := ""
				if purpose == loginPurposeClient {
					authorization, err := service.BeginAuthorization(t.Context(), url.Values{
						"response_type": {"code"}, "client_id": {"monkeyai-desktop"},
						"redirect_uri": {"monkeyai-desktop://oauth/callback"}, "state": {"client-state"},
						"code_challenge": {strings.Repeat("A", 43)}, "code_challenge_method": {"S256"},
					})
					if err != nil {
						t.Fatal(err)
					}
					requestID = authorization.ID
				}
				if err := service.createLoginState(t.Context(), tokenHash("test-state"), "oidc", requestID, purpose, service.now().Add(service.requestTTL)); err != nil {
					t.Fatal(err)
				}
				recorder := httptest.NewRecorder()
				request := httptest.NewRequest(http.MethodGet, "/oauth/callback?state=test-state&code=code", nil)
				service.upstreamCallback(recorder, request)
				redirect, err := url.Parse(recorder.Header().Get("Location"))
				if err != nil {
					t.Fatal(err)
				}
				path, queryKey := "/client-login", "error"
				if purpose == loginPurposeAdmin {
					path, queryKey = "/login", "oauth_error"
				}
				if recorder.Code != http.StatusFound || redirect.Path != path || redirect.Query().Get(queryKey) != tc.code || redirect.Query().Get("request_id") != requestID {
					t.Fatalf("OAuth 跳转错误: status=%d location=%s", recorder.Code, redirect)
				}
				var count int
				if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM browser_sessions").Scan(&count); err != nil || count != 0 || len(recorder.Result().Cookies()) != 0 {
					t.Fatalf("席位不足时不得创建会话: count=%d err=%v", count, err)
				}
			})
		}
	}
}
