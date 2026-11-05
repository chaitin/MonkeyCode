package enginehost

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestRenewPendingEnrollment(t *testing.T) {
	pool := testPool(t)
	s := NewService(pool).WithInstallation("https://control.example", fixture(t), "v1")
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	s.Register(router)
	created := call(router, "POST", "/engine-host-enrollments", map[string]string{})
	var first struct {
		ID      string `json:"host_id"`
		Command string `json:"command"`
	}
	if created.Code != 201 || json.Unmarshal(created.Body.Bytes(), &first) != nil {
		t.Fatalf("创建失败: %s", created.Body)
	}
	path := "/engine-hosts/" + first.ID + "/enrollment"
	old := strings.Split(strings.Split(first.Command, "token=")[1], "'")[0]
	if _, err := pool.Exec(t.Context(), `UPDATE engine_hosts SET enrollment_expires_at=now()-interval '1 minute' WHERE id=$1`, first.ID); err != nil {
		t.Fatal(err)
	}
	renewed := call(router, "POST", path, map[string]string{})
	var next struct {
		ID      string `json:"host_id"`
		Command string `json:"command"`
	}
	if renewed.Code != 200 || json.Unmarshal(renewed.Body.Bytes(), &next) != nil || next.ID != first.ID || next.Command == first.Command || renewed.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("重新生成失败: %d %s", renewed.Code, renewed.Body)
	}
	if w := call(router, "GET", "/api/host/v1/install.sh?token="+old, nil); w.Code != 401 {
		t.Fatal("旧命令未失效")
	}
	secret := strings.Split(strings.Split(next.Command, "token=")[1], "'")[0]
	if w := call(router, "GET", "/api/host/v1/install.sh?token="+secret, nil); w.Code != 200 {
		t.Fatal("新命令不可用")
	}
	listed := call(router, "GET", "/engine-hosts", nil)
	if strings.Contains(listed.Body.String(), secret) {
		t.Fatal("列表泄露令牌")
	}
	var count int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM engine_hosts`).Scan(&count); err != nil || count != 1 {
		t.Fatal("重新生成创建了额外宿主")
	}
	for _, state := range []string{"active", "revoked"} {
		if _, err := pool.Exec(t.Context(), `UPDATE engine_hosts SET status=$2 WHERE id=$1`, first.ID, state); err != nil {
			t.Fatal(err)
		}
		if w := call(router, "POST", path, map[string]string{}); w.Code != 409 {
			t.Fatalf("允许重置 %s 宿主", state)
		}
	}
}
