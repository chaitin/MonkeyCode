package enginehost

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func commandCredential(t *testing.T, command string) string {
	t.Helper()
	parts := strings.Split(command, "token=")
	if len(parts) != 2 {
		t.Fatal("命令缺少凭证")
	}
	raw := strings.Split(parts[1], "'")[0]
	value, err := url.QueryUnescape(raw)
	if err != nil {
		t.Fatal(err)
	}
	return value
}
func TestRenewPendingEnrollment(t *testing.T) {
	db := testPool(t)
	s := NewService(db).WithInstallation("https://control.example", fixture(t), "v1")
	router := chi.NewRouter()
	registerAdmin(router, s)
	s.Register(router)
	var first struct {
		ID      string `json:"host_id"`
		Command string `json:"command"`
	}
	created := call(router, "POST", "/engine-host-enrollments", map[string]any{})
	if created.Code != 201 || json.Unmarshal(created.Body.Bytes(), &first) != nil {
		t.Fatal(created.Code, created.Body.String())
	}
	var next struct {
		ID      string `json:"host_id"`
		Command string `json:"command"`
	}
	renewed := call(router, "POST", "/engine-hosts/"+first.ID+"/enrollment", map[string]any{})
	if renewed.Code != 200 || json.Unmarshal(renewed.Body.Bytes(), &next) != nil || next.ID == first.ID {
		t.Fatal("重发须替换待接入身份", renewed.Code, renewed.Body.String())
	}
	oldToken := commandCredential(t, first.Command)
	nextToken := commandCredential(t, next.Command)
	if w := call(router, "GET", "/api/host/v1/install.sh?token="+url.QueryEscape(oldToken), nil); w.Code != 401 {
		t.Fatal("旧凭证未失效", w.Code)
	}
	if w := call(router, "GET", "/api/host/v1/install.sh?token="+url.QueryEscape(nextToken), nil); w.Code != 200 {
		t.Fatal("新凭证不可用", w.Code, w.Body.String())
	}
	var revoked bool
	if err := db.QueryRow(t.Context(), "SELECT status='revoked' AND deleted_at IS NOT NULL FROM hosts WHERE id=$1", first.ID).Scan(&revoked); err != nil || !revoked {
		t.Fatal("未保留旧身份撤销记录", err)
	}
	listed := call(router, "GET", "/engine-hosts", nil)
	var data struct {
		Items []json.RawMessage `json:"items"`
	}
	if json.Unmarshal(listed.Body.Bytes(), &data) != nil || len(data.Items) != 1 || strings.Contains(listed.Body.String(), nextToken) {
		t.Fatal("重发列表或凭证过滤错误")
	}
	for _, status := range []string{"active", "revoked"} {
		if _, err := db.Exec(t.Context(), "UPDATE hosts SET status=$2 WHERE id=$1", next.ID, status); err != nil {
			t.Fatal(err)
		}
		if w := call(router, "POST", "/engine-hosts/"+next.ID+"/enrollment", map[string]any{}); w.Code != 409 {
			t.Fatal("重发已接入或撤销身份", status, w.Code)
		}
	}
}
