package identity

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestPatchUserPromotesWithoutChangingPassword(t *testing.T) {
	pool := emailDatabase(t)
	service := NewService(pool, authenticationStub{json.RawMessage(`{"password_enabled":true}`)}, "http://localhost")
	router := chi.NewRouter()
	service.RegisterAdmin(router)

	for _, tc := range []struct {
		name             string
		existingPassword string
		requestPassword  string
	}{
		{name: "without_password"},
		{name: "keeps_existing_password", existingPassword: "original-password-123"},
		{name: "ignores_legacy_request_password", existingPassword: "original-password-123", requestPassword: "replacement-password-123"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			passwordHash := ""
			if tc.existingPassword != "" {
				var err error
				passwordHash, err = hashPassword(tc.existingPassword)
				if err != nil {
					t.Fatal(err)
				}
			}
			user, err := service.insertUser(t.Context(), tc.name, tc.name+"@example.com", "user", passwordHash)
			if err != nil {
				t.Fatal(err)
			}
			input := map[string]string{"name": user.Name, "role": "admin", "status": "active"}
			if tc.requestPassword != "" {
				input["password"] = tc.requestPassword
			}
			body, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPatch, "/users/"+user.ID, bytes.NewReader(body))
			request = request.WithContext(context.WithValue(request.Context(), userContextKey{}, User{ID: "current-admin"}))
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("提升管理员失败: status=%d body=%s", response.Code, response.Body.String())
			}
			var updated User
			if err := json.Unmarshal(response.Body.Bytes(), &updated); err != nil {
				t.Fatal(err)
			}
			if updated.ID != user.ID || updated.Role != "admin" {
				t.Fatalf("角色未更新: %+v", updated)
			}
			var savedHash *string
			if err := pool.QueryRow(t.Context(), "SELECT password_hash FROM users WHERE id = $1", user.ID).Scan(&savedHash); err != nil {
				t.Fatal(err)
			}
			if passwordHash == "" && savedHash != nil || passwordHash != "" && (savedHash == nil || *savedHash != passwordHash) {
				t.Fatalf("提升管理员不应修改密码: got %v, want original hash", savedHash)
			}
			if tc.existingPassword != "" {
				authCall(t, service, "/admin/login", map[string]string{"email": user.Email, "password": tc.existingPassword}, http.StatusOK)
			}
		})
	}
}
