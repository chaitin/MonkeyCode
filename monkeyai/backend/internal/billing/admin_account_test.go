package billing

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestAdminAccountIncludesCurrentUser(t *testing.T) {
	s, userID, _ := fixture(t)
	if _, err := s.pool.Exec(t.Context(), `UPDATE users SET name='更新后的成员' WHERE id=$1`, userID); err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/billing/accounts/"+userID, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("读取账户: %d %s", response.Code, response.Body.String())
	}
	var account struct {
		UserName  string `json:"user_name"`
		UserEmail string `json:"user_email"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &account); err != nil {
		t.Fatal(err)
	}
	if account.UserName != "更新后的成员" || account.UserEmail != "billing@example.com" {
		t.Fatalf("账户应包含当前用户资料: %+v", account)
	}
}
