package identity

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/member"
	"github.com/go-chi/chi/v5"
)

func TestCreateUserInitialPassword(t *testing.T) {
	seen := map[string]bool{}
	for _, tc := range []struct {
		name, role, password string
		err                  error
		status               int
	}{
		{name: "generated", role: "user", status: http.StatusCreated},
		{name: "independent", role: "user", status: http.StatusCreated},
		{name: "ignore user input", role: "user", password: "not-the-generated-password", status: http.StatusCreated},
		{name: "preserve admin input", role: "admin", password: "custom-admin-password-123", status: http.StatusCreated},
		{name: "short admin password", role: "admin", password: "short", status: http.StatusBadRequest},
		{name: "failed user creation", role: "user", err: member.ErrSeatsExceeded, status: http.StatusConflict},
		{name: "failed admin creation", role: "admin", password: "private-admin-password", err: member.ErrSeatsUnavailable, status: http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			writer := &createWriter{err: tc.err}
			service := NewService(nil, nil, "").WithUserWriter(writer)
			input, err := json.Marshal(map[string]string{"name": "New member", "email": "new@example.com", "role": tc.role, "password": tc.password})
			if err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			service.createUser(response, httptest.NewRequest(http.MethodPost, "/users", bytes.NewReader(input)))
			if response.Code != tc.status || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("status=%d cache=%q", response.Code, response.Header().Get("Cache-Control"))
			}
			var result struct {
				User
				InitialPassword string `json:"initial_password"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if tc.status != http.StatusCreated {
				if strings.Contains(response.Body.String(), "initial_password") || writer.input.Password != "" && strings.Contains(response.Body.String(), writer.input.Password) {
					t.Fatal("failed creation disclosed a password")
				}
				return
			}
			if result.ID != "created" || result.InitialPassword == "" || result.InitialPassword != writer.input.Password {
				t.Fatal("creation did not return the password sent to the writer with the user")
			}
			if tc.role == "admin" {
				if result.InitialPassword != tc.password {
					t.Fatal("administrator password changed")
				}
			} else {
				password := result.InitialPassword
				if !regexp.MustCompile(`^[A-Za-z0-9]{16}$`).MatchString(password) || !strings.ContainsAny(password, "0123456789") || !strings.ContainsAny(password, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") || !strings.ContainsAny(password, "abcdefghijklmnopqrstuvwxyz") || password == tc.password || seen[password] {
					t.Fatal("generated password must be independent and contain digits and both letter cases")
				}
				seen[password] = true
			}
		})
	}
}

func TestInitialPasswordStoredAsHashAndNotInMemberReads(t *testing.T) {
	pool := emailDatabase(t)
	service := newTestService(pool, authenticationStub{json.RawMessage(`{"password_enabled":true}`)}, "http://localhost")
	router := chi.NewRouter()
	service.RegisterAdmin(router)
	for _, role := range []string{"user", "admin"} {
		t.Run(role, func(t *testing.T) {
			input, err := json.Marshal(map[string]string{"name": role, "email": role + "@example.com", "role": role, "password": "original-admin-password-123"})
			if err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/users", bytes.NewReader(input)))
			if response.Code != http.StatusCreated {
				t.Fatalf("create status=%d", response.Code)
			}
			var result struct {
				User
				InitialPassword string `json:"initial_password"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			var hash string
			if err := pool.QueryRow(t.Context(), "SELECT password_hash FROM users WHERE id=$1", result.ID).Scan(&hash); err != nil {
				t.Fatal(err)
			}
			if result.InitialPassword == "" || hash == result.InitialPassword || !verifyPassword(result.InitialPassword, hash) {
				t.Fatal("returned initial password does not match the stored password hash")
			}
			for _, path := range []string{"/users", "/users/" + result.ID} {
				read := httptest.NewRecorder()
				router.ServeHTTP(read, httptest.NewRequest(http.MethodGet, path, nil))
				if read.Code != http.StatusOK || strings.Contains(read.Body.String(), "password") || strings.Contains(read.Body.String(), result.InitialPassword) || strings.Contains(read.Body.String(), hash) {
					t.Fatalf("member read exposed credentials or failed: %s status=%d", path, read.Code)
				}
			}
			path := "/login"
			if role == "admin" {
				path = "/admin/login"
			}
			authCall(t, service, path, map[string]string{"email": result.Email, "password": result.InitialPassword}, http.StatusOK)
		})
	}
}
