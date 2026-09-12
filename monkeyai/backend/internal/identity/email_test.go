package identity

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type mailStub struct {
	code  string
	calls int
	fail  bool
}

func (m *mailStub) Send(_ context.Context, _, _, body string) error {
	m.calls++
	m.code = regexp.MustCompile(`[0-9]{6}`).FindString(body)
	if m.fail {
		return errors.New("SMTP 拒收")
	}
	return nil
}

func emailDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行邮箱认证集成测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	suffix, err := randomToken(12)
	if err != nil {
		t.Fatal(err)
	}
	schema := pgx.Identifier{"test_email_" + suffix}.Sanitize()
	if _, err := root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, err := root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		if err != nil {
			t.Error(err)
		}
	})
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(data)); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
	}
	return pool
}

func authCall(t *testing.T, s *Service, path string, body any, want int) *httptest.ResponseRecorder {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(string(data)))
	req.RemoteAddr = "127.0.0.1:10000"
	rec := httptest.NewRecorder()
	s.AuthRouter().ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("%s: status=%d want=%d body=%s", path, rec.Code, want, rec.Body.String())
	}
	return rec
}

func TestEmailAuthentication(t *testing.T) {
	pool := emailDatabase(t)
	sender := &mailStub{}
	s := NewService(pool, authenticationStub{json.RawMessage(`{"password_enabled":true,"email_code_enabled":true,"registration_enabled":true}`)}, "http://localhost").WithEmailSender(sender)
	ctx := t.Context()
	clearLimit := func() {
		t.Helper()
		if _, err := pool.Exec(ctx, "DELETE FROM email_code_deliveries"); err != nil {
			t.Fatal(err)
		}
	}
	authCall(t, s, "/email/code", emailInput{Email: "USER@EXAMPLE.COM", Purpose: "register"}, 200)
	code := sender.code
	var hash string
	if err := pool.QueryRow(ctx, "SELECT code_hash FROM email_codes").Scan(&hash); err != nil || hash == code {
		t.Fatalf("验证码未正确散列: %v", err)
	}
	authCall(t, s, "/email/code", emailInput{Email: "user@example.com", Purpose: "login"}, 429)
	authCall(t, s, "/email/register", emailInput{Email: "user@example.com", Code: code, Name: "普通用户", Password: "long-password-123"}, 200)
	authCall(t, s, "/email/register", emailInput{Email: "user@example.com", Code: code, Name: "重放", Password: "long-password-123"}, 400)
	login := authCall(t, s, "/login", emailInput{Email: "USER@EXAMPLE.COM", Password: "long-password-123"}, 200)
	if len(login.Result().Cookies()) != 1 {
		t.Fatal("未创建会话")
	}
	authCall(t, s, "/admin/login", emailInput{Email: "user@example.com", Password: "long-password-123"}, 401)
	clearLimit()
	authCall(t, s, "/email/code", emailInput{Email: "user@example.com", Purpose: "login"}, 200)
	code = sender.code
	authCall(t, s, "/admin/email/login", emailInput{Email: "user@example.com", Code: code}, 401)
	authCall(t, s, "/email/login", emailInput{Email: "user@example.com", Code: code}, 200)
	authCall(t, s, "/email/login", emailInput{Email: "user@example.com", Code: code}, 400)

	var userID string
	if err := pool.QueryRow(ctx, "SELECT id FROM users WHERE email = 'user@example.com'").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	request, err := s.BeginAuthorization(ctx, url.Values{
		"response_type": {"code"}, "client_id": {"monkeyai-desktop"}, "redirect_uri": {"monkeyai-desktop://oauth/callback"}, "state": {"test-state"}, "code_challenge": {strings.Repeat("A", 43)}, "code_challenge_method": {"S256"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteAuthorization(ctx, request.ID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'monkeyai-desktop','access-hash','refresh-hash',now()+interval '1 hour',now()+interval '1 day')`, userID); err != nil {
		t.Fatal(err)
	}
	clearLimit()
	authCall(t, s, "/email/code", emailInput{Email: "user@example.com", Purpose: "reset"}, 200)
	code = sender.code
	authCall(t, s, "/email/login", emailInput{Email: "user@example.com", Code: code}, 400)
	authCall(t, s, "/email/reset-password", emailInput{Email: "user@example.com", Code: code, Password: "new-password-123"}, 200)
	authCall(t, s, "/login", emailInput{Email: "user@example.com", Password: "long-password-123"}, 401)
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM browser_sessions WHERE revoked_at IS NULL").Scan(&count); err != nil || count != 0 {
		t.Fatalf("旧会话未撤销: %d %v", count, err)
	}

	for _, query := range []string{"SELECT count(*) FROM oauth_tokens WHERE revoked_at IS NULL", "SELECT count(*) FROM oauth_authorization_codes WHERE redeemed_at IS NULL"} {
		if err := pool.QueryRow(ctx, query).Scan(&count); err != nil || count != 0 {
			t.Fatalf("旧令牌或授权码未撤销: %d %v", count, err)
		}
	}
	authCall(t, s, "/login", emailInput{Email: "user@example.com", Password: "new-password-123"}, 200)
	// 错误次数在失败响应后仍然持久化，正确验证码也不能绕过上限。
	clearLimit()
	authCall(t, s, "/email/code", emailInput{Email: "user@example.com", Purpose: "login"}, 200)
	code = sender.code
	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	for range 5 {
		authCall(t, s, "/email/login", emailInput{Email: "user@example.com", Code: wrong}, 400)
	}
	authCall(t, s, "/email/login", emailInput{Email: "user@example.com", Code: code}, 400)
	clearLimit()
	authCall(t, s, "/email/code", emailInput{Email: "user@example.com", Purpose: "login"}, 200)
	code = sender.code
	if _, err := pool.Exec(ctx, "UPDATE email_codes SET expires_at = now() - interval '1 second'"); err != nil {
		t.Fatal(err)
	}
	authCall(t, s, "/email/login", emailInput{Email: "user@example.com", Code: code}, 400)
	clearLimit()
	sender.fail = true
	authCall(t, s, "/email/code", emailInput{Email: "user@example.com", Purpose: "login"}, 502)
	authCall(t, s, "/email/login", emailInput{Email: "user@example.com", Code: sender.code}, 400)
	sender.fail = false
	clearLimit()
	calls := sender.calls
	s.settings = authenticationStub{json.RawMessage(`{"password_enabled":true,"email_code_enabled":true,"registration_enabled":false}`)}
	authCall(t, s, "/email/code", emailInput{Email: "missing@example.com", Purpose: "login"}, 200)
	if sender.calls != calls {
		t.Fatal("未知账号收到登录邮件")
	}
	// 关掉入口后，已有验证码也不能继续认证。
	s.settings = authenticationStub{json.RawMessage(`{"password_enabled":false,"email_code_enabled":false,"registration_enabled":false}`)}
	authCall(t, s, "/login", emailInput{Email: "user@example.com", Password: "new-password-123"}, 403)
	authCall(t, s, "/admin/login", emailInput{Email: "admin@example.com", Password: "password"}, 403)
	authCall(t, s, "/email/login", emailInput{Email: "user@example.com", Code: "123456"}, 403)
	authCall(t, s, "/email/register", emailInput{Email: "new@example.com", Code: "123456", Name: "用户", Password: "new-password-123"}, 403)
	authCall(t, s, "/email/reset-password", emailInput{Email: "user@example.com", Code: "123456", Password: "new-password-123"}, 403)
}

func TestEmailAutoRegistration(t *testing.T) {
	for _, test := range []struct {
		name           string
		closed         bool
		closeAfter     bool
		disableAfter   bool
		admin          bool
		existingStatus string
		createAfter    bool
		wantMail       bool
		wantStatus     int
	}{
		{name: "自动创建账号", wantMail: true, wantStatus: 200},
		{name: "注册关闭", closed: true, wantStatus: 400},
		{name: "发送后关闭注册", closeAfter: true, wantMail: true, wantStatus: 401},
		{name: "发送后关闭验证码登录", disableAfter: true, wantMail: true, wantStatus: 403},
		{name: "管理员入口不创建账号", admin: true, wantMail: true, wantStatus: 401},
		{name: "停用账号不发送", existingStatus: "disabled", wantStatus: 400},
		{name: "发送后账号被停用", existingStatus: "disabled", createAfter: true, wantMail: true, wantStatus: 401},
		{name: "发送后账号已创建", existingStatus: "active", createAfter: true, wantMail: true, wantStatus: 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			pool := emailDatabase(t)
			sender := &mailStub{}
			methods := loginMethods{EmailCodeEnabled: true, RegistrationEnabled: !test.closed}
			s := NewService(pool, nil, "http://localhost").WithEmailSender(sender)
			setMethods := func() {
				t.Helper()
				value, err := json.Marshal(methods)
				if err != nil {
					t.Fatal(err)
				}
				s.settings = authenticationStub{value}
			}
			setMethods()
			input := emailInput{Email: "new@example.com", Purpose: "login"}
			var existing User
			createUser := func() {
				t.Helper()
				var err error
				existing, err = s.insertUser(t.Context(), "已有姓名", input.Email, "user", "")
				if err != nil {
					t.Fatal(err)
				}
				if _, err := s.updateUser(t.Context(), existing.ID, existing.Name, existing.Role, test.existingStatus, ""); err != nil {
					t.Fatal(err)
				}
			}
			if test.existingStatus != "" && !test.createAfter {
				createUser()
			}
			countUsers := func(want int) {
				t.Helper()
				var count int
				if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM users").Scan(&count); err != nil || count != want {
					t.Fatalf("账号数量=%d，期望=%d，错误=%v", count, want, err)
				}
			}
			authCall(t, s, "/email/code", emailInput{Email: " NEW@EXAMPLE.COM ", Purpose: "login"}, 200)
			if (sender.calls == 1) != test.wantMail {
				t.Fatalf("邮件发送次数=%d，期望发送=%t", sender.calls, test.wantMail)
			}
			if existing.ID == "" {
				countUsers(0)
			}
			if test.createAfter {
				createUser()
			}
			methods.RegistrationEnabled = methods.RegistrationEnabled && !test.closeAfter
			methods.EmailCodeEnabled = !test.disableAfter
			setMethods()
			path := "/email/login"
			if test.admin {
				path = "/admin/email/login"
			}
			input.Code = sender.code
			if input.Code == "" {
				input.Code = "123456"
			}
			if test.wantStatus == 200 && existing.ID == "" {
				wrong := input
				wrong.Code = "000000"
				if wrong.Code == input.Code {
					wrong.Code = "111111"
				}
				authCall(t, s, path, wrong, 400)
				countUsers(0)
			}
			response := authCall(t, s, path, input, test.wantStatus)
			if test.wantStatus != 200 {
				if existing.ID == "" {
					countUsers(0)
				} else {
					countUsers(1)
				}
				if len(response.Result().Cookies()) != 0 {
					t.Fatal("被拒绝的登录不应创建会话")
				}
				return
			}
			countUsers(1)
			var user User
			if err := json.Unmarshal(response.Body.Bytes(), &user); err != nil {
				t.Fatal(err)
			}
			if user.Email != input.Email || user.Role != "user" || user.Status != "active" {
				t.Fatalf("登录账号异常: %+v", user)
			}
			if existing.ID != "" && (user.ID != existing.ID || user.Name != existing.Name) {
				t.Fatal("已有账号被覆盖")
			}
			var password *string
			if err := pool.QueryRow(t.Context(), "SELECT password_hash FROM users WHERE id = $1", user.ID).Scan(&password); err != nil || password != nil {
				t.Fatalf("无密码登录不应设置密码: %v", err)
			}
			cookies := response.Result().Cookies()
			if len(cookies) != 1 {
				t.Fatal("未建立登录会话")
			}
			checkClientAuthorization(t, s, cookies[0], user)
			authCall(t, s, path, input, 400)
		})
	}
}

func TestConcurrentEmailAutoRegistration(t *testing.T) {
	pool := emailDatabase(t)
	sender := &mailStub{}
	s := NewService(pool, authenticationStub{json.RawMessage(`{"email_code_enabled":true,"registration_enabled":true}`)}, "http://localhost").WithEmailSender(sender)
	input := emailInput{Email: "new@example.com", Purpose: "login"}
	authCall(t, s, "/email/code", input, 200)
	input.Code = sender.code
	body, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan int, 8)
	for range 8 {
		wg.Go(func() {
			req := httptest.NewRequest(http.MethodPost, "/email/login", strings.NewReader(string(body)))
			rec := httptest.NewRecorder()
			s.AuthRouter().ServeHTTP(rec, req)
			results <- rec.Code
		})
	}
	wg.Wait()
	close(results)
	success := 0
	for status := range results {
		if status == 200 {
			success++
		} else if status != 400 {
			t.Fatalf("并发登录返回异常状态: %d", status)
		}
	}
	if success != 1 {
		t.Fatalf("同一验证码登录成功次数=%d", success)
	}
	for _, query := range []string{"SELECT count(*) FROM users", "SELECT count(*) FROM browser_sessions"} {
		var count int
		if err := pool.QueryRow(t.Context(), query).Scan(&count); err != nil || count != 1 {
			t.Fatalf("账号或会话数量=%d，错误=%v", count, err)
		}
	}
}

func TestConcurrentEmailCode(t *testing.T) {
	pool := emailDatabase(t)
	s := NewService(pool, nil, "")
	input := emailInput{Email: "user@example.com", Purpose: "login"}
	var wg sync.WaitGroup
	results := make(chan error, 8)
	for range 8 {
		wg.Go(func() { results <- s.reserveCode(t.Context(), input, "123456", "ip") })
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else if !errors.Is(err, errCodeLimited) {
			t.Fatal(err)
		}
	}
	if success != 1 {
		t.Fatalf("并发发送成功次数=%d", success)
	}
	if _, err := pool.Exec(t.Context(), "UPDATE email_codes SET ready = true"); err != nil {
		t.Fatal(err)
	}
	consumed := make(chan error, 8)
	input.Code = "123456"
	for range 8 {
		wg.Go(func() {
			tx, err := pool.Begin(t.Context())
			if err != nil {
				consumed <- err
				return
			}
			defer tx.Rollback(t.Context())
			err = consumeEmailCode(t.Context(), tx, input)
			if err == nil {
				err = tx.Commit(t.Context())
			}
			consumed <- err
		})
	}
	wg.Wait()
	close(consumed)
	success = 0
	for err := range consumed {
		if err == nil {
			success++
		} else if !errors.Is(err, errInvalidCode) {
			t.Fatal(err)
		}
	}
	if success != 1 {
		t.Fatalf("验证码并发消费次数=%d", success)
	}
}
