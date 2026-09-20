package identity

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestGeneratePassword(t *testing.T) {
	pattern := regexp.MustCompile(`^[0-9A-Za-z]{16}$`)
	seen := make(map[string]bool)
	for range 128 {
		password, err := generatePassword()
		if err != nil {
			t.Fatal(err)
		}
		if !pattern.MatchString(password) || !strings.ContainsAny(password, "0123456789") || !strings.ContainsAny(password, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") || !strings.ContainsAny(password, "abcdefghijklmnopqrstuvwxyz") {
			t.Fatalf("随机密码格式错误: %q", password)
		}
		if seen[password] {
			t.Fatal("生成了重复的随机密码")
		}
		seen[password] = true
	}
}

func TestAdminResetPassword(t *testing.T) {
	pool := emailDatabase(t)
	service := NewService(pool, authenticationStub{json.RawMessage(`{"password_enabled":true}`)}, "http://localhost")
	router := chi.NewRouter()
	service.RegisterAdmin(router)

	for _, tc := range []struct {
		name     string
		role     string
		status   string
		password string
	}{
		{name: "regular", role: "user", status: "active", password: "original-password-123"},
		{name: "admin", role: "admin", status: "active", password: "original-password-123"},
		{name: "passwordless", role: "user", status: "active"},
		{name: "disabled", role: "user", status: "disabled"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			hash := ""
			if tc.password != "" {
				var err error
				hash, err = hashPassword(tc.password)
				if err != nil {
					t.Fatal(err)
				}
			}
			user, err := service.insertUser(t.Context(), tc.name, tc.name+"@example.com", tc.role, hash)
			if err != nil {
				t.Fatal(err)
			}
			if tc.status == "disabled" {
				if _, err := service.updateUser(t.Context(), user.ID, user.Name, user.Role, "disabled", ""); err != nil {
					t.Fatal(err)
				}
			}
			loginPath := "/login"
			if tc.role == "admin" {
				loginPath = "/admin/login"
			}
			var oldSession *http.Cookie
			if tc.password != "" {
				oldSession = authCall(t, service, loginPath, map[string]string{"email": user.Email, "password": tc.password}, http.StatusOK).Result().Cookies()[0]
			}

			request := httptest.NewRequest(http.MethodPost, "/users/"+user.ID+"/reset-password", nil)
			request = request.WithContext(context.WithValue(request.Context(), userContextKey{}, User{ID: "current-admin"}))
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("重置密码失败: status=%d cache=%q body=%s", response.Code, response.Header().Get("Cache-Control"), response.Body.String())
			}
			var result struct {
				Password string `json:"password"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if len(result.Password) != 16 {
				t.Fatalf("返回的密码长度=%d", len(result.Password))
			}
			var savedHash *string
			var savedStatus string
			if err := pool.QueryRow(t.Context(), "SELECT password_hash, status FROM users WHERE id = $1", user.ID).Scan(&savedHash, &savedStatus); err != nil {
				t.Fatal(err)
			}
			if savedHash == nil || !verifyPassword(result.Password, *savedHash) || savedStatus != tc.status {
				t.Fatalf("密码或状态更新不符合预期: status=%s", savedStatus)
			}
			if tc.password != "" {
				if verifyPassword(tc.password, *savedHash) {
					t.Fatal("旧密码仍可登录")
				}
				browserRequest := httptest.NewRequest(http.MethodGet, "/me", nil)
				browserRequest.AddCookie(oldSession)
				if _, valid := service.BrowserUser(browserRequest); valid {
					t.Fatal("旧浏览器会话仍有效")
				}
			}
			if tc.status == "active" {
				authCall(t, service, loginPath, map[string]string{"email": user.Email, "password": result.Password}, http.StatusOK)
			} else {
				authCall(t, service, loginPath, map[string]string{"email": user.Email, "password": result.Password}, http.StatusUnauthorized)
			}
		})
	}
}
