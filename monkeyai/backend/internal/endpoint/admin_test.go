package endpoint

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestAdminDeviceInventory(t *testing.T) {
	pool := testDatabase(t)
	admin, user, deleted := testUser(t, pool, "inventory-admin"), testUser(t, pool, "inventory-user"), testUser(t, pool, "inventory-deleted")
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(t.Context(), query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`UPDATE users SET role='admin',name='管理员',email='admin@inventory.test',avatar_url=' /avatar.png ' WHERE id=$1`, admin)
	exec(`UPDATE users SET name='普通成员',email='member@inventory.test' WHERE id=$1`, user)
	exec(`UPDATE users SET deleted_at=now() WHERE id=$1`, deleted)
	machine := resource.ID()
	ids := []string{resource.ID(), resource.ID(), resource.ID(), resource.ID(), resource.ID()}
	for i, owner := range []string{admin, admin, user, user, deleted} {
		m := resource.ID()
		if i == 0 || i == 2 {
			m = machine
		}
		exec(`INSERT INTO endpoints(id,user_id,machine_id,device_name,platform,os_version,arch,client_version,client_type,client_name,locale,system_locale,runtime_version,engine_version,created_at,last_seen_at,last_reported_at,status,revoked_at)
 VALUES($1,$2,$3,$4,$5,'11','arm64',$6,'desktop','MonkeyAI','zh-CN','en-US','22.1','1.9','2025-01-01',
 CASE WHEN $7=3 THEN NULL ELSE ('2026-10-20'::timestamptz+$7*interval '1 day') END,
 CASE WHEN $7=3 THEN NULL ELSE ('2026-10-20'::timestamptz+$7*interval '2 day') END,
 CASE WHEN $7=4 THEN 'revoked' ELSE 'active' END,CASE WHEN $7=4 THEN now() ELSE NULL END)`, ids[i], owner, m, fmt.Sprintf("测试设备 %d", i), []string{"windows", "Windows", "linux", "custom-os", "macos"}[i], fmt.Sprintf("1.%d", i), i)
	}
	// A device can be inventoried without any reported conversations.
	var facts int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM session_turns`).Scan(&facts); err != nil || facts != 0 {
		t.Fatalf("unexpected conversation facts: %d %v", facts, err)
	}
	service := NewService(NewPostgres(pool), nil, nil, "")
	router := chi.NewRouter()
	router.Use(identity.NewService(pool, nil, "").RequireAdmin)
	service.RegisterAdmin(router)
	for _, id := range []string{admin, user} {
		hash := sha256.Sum256([]byte(id))
		exec(`INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, hex.EncodeToString(hash[:]), id)
	}
	call := func(path, token string, status int) map[string]any {
		t.Helper()
		r := httptest.NewRequest("GET", path, nil)
		if token != "" {
			r.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: token})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body)
		}
		if status == 200 && w.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("inventory must not be cached")
		}
		var out map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	for _, path := range []string{"/endpoints", "/endpoints/overview"} {
		call(path, "", 401)
		call(path, user, 403)
	}
	list := call("/endpoints?page_size=2", admin, 200)
	if len(list["items"].([]any)) != 2 || list["has_next"] != true || list["total"] != nil {
		t.Fatalf("bounded page: %#v", list)
	}
	first := list["items"].([]any)[0].(map[string]any)
	if first["id"] != ids[4] || first["user_deleted"] != true || first["status"] != "revoked" {
		t.Fatalf("latest activity and deleted user: %#v", first)
	}
	for _, field := range []string{"execution_public_key", "key_id", "active_grant_id", "registration_version", "grant_version", "lease_epoch", "execution_protocols", "password_hash", "electron_version", "channel"} {
		if _, ok := first[field]; ok {
			t.Fatalf("sensitive/internal field exposed: %s", field)
		}
	}
	list = call("/endpoints?page_size=2&page=3", admin, 200)
	last := list["items"].([]any)[0].(map[string]any)
	if len(list["items"].([]any)) != 1 || list["has_next"] != false || last["id"] != ids[3] || last["last_active_at"] != nil {
		t.Fatalf("null activity sorted last: %#v", list)
	}
	list = call("/endpoints?page=99", admin, 200)
	if len(list["items"].([]any)) != 0 {
		t.Fatal("out-of-range page must be empty")
	}
	for _, tc := range []struct {
		query        string
		count, users int
	}{
		{"", 5, 3}, {"user_id=" + admin, 2, 1}, {"query=" + url.QueryEscape("普通成员"), 2, 1}, {"query=ADMIN%40INVENTORY.TEST", 2, 1},
		{"query=MonkeyAI", 5, 3}, {"query=%25", 0, 0}, {"query=%5F", 0, 0}, {"query=" + machine, 2, 2},
		{"platform=WINDOWS", 2, 1}, {"client_type=DESKTOP", 5, 3}, {"arch=ARM64", 5, 3}, {"client_version=1.2", 1, 1},
		{"status=revoked", 1, 1}, {"status=active&platform=linux", 1, 1},
		{"from=2026-10-24T00:00:00Z", 2, 2}, {"until=2026-10-24T00:00:00Z", 2, 1},
		{"from=2026-10-24T00:00:00Z&until=2026-10-28T00:00:00Z", 1, 1},
	} {
		rows := call("/endpoints?"+tc.query, admin, 200)["items"].([]any)
		overview := call("/endpoints/overview?"+tc.query, admin, 200)
		if len(rows) != tc.count || overview["metric"] != "devices" || overview["total"] != float64(tc.count) || overview["users"] != float64(tc.users) {
			t.Fatalf("filter %s: list=%d overview=%#v", tc.query, len(rows), overview)
		}
		for _, entries := range overview["distributions"].(map[string]any) {
			sum := float64(0)
			for _, entry := range entries.([]any) {
				sum += entry.(map[string]any)["count"].(float64)
			}
			if sum != float64(tc.count) {
				t.Fatalf("inconsistent distribution: %#v", overview)
			}
		}
	}
	all := call("/endpoints/overview", admin, 200)
	for _, entry := range all["distributions"].(map[string]any)["platform"].([]any) {
		item := entry.(map[string]any)
		if item["value"] == "windows" && item["count"] != float64(2) {
			t.Fatal("known OS case variants must share a chart category")
		}
	}
	// Legacy clients may not have reported a type; the Unknown filter includes them.
	exec(`UPDATE endpoints SET client_type=NULL WHERE id=$1`, ids[3])
	unknown := call("/endpoints?client_type=unknown", admin, 200)["items"].([]any)
	if len(unknown) != 1 || unknown[0].(map[string]any)["id"] != ids[3] {
		t.Fatalf("missing client type was excluded: %#v", unknown)
	}
	unknownOverview := call("/endpoints/overview?client_type=unknown", admin, 200)
	if unknownOverview["total"] != float64(1) {
		t.Fatalf("unknown type overview differs: %#v", unknownOverview)
	}
	// Updated registration details remain one row rather than accumulating versions.
	exec(`UPDATE endpoints SET client_version='2.0',runtime_version='24',engine_version='2.1' WHERE id=$1`, ids[0])
	changed := call("/endpoints?user_id="+admin+"&client_version=2.0", admin, 200)["items"].([]any)
	if len(changed) != 1 || changed[0].(map[string]any)["runtime_version"] != "24" {
		t.Fatalf("updated registration not reflected: %#v", changed)
	}
	for _, query := range []string{"page=0", "page_size=501", "page=no", "user_id=invalid", "status=online", "from=bad", "from=2026-10-25T00:00:00Z&until=2026-10-24T00:00:00Z", "query=" + url.QueryEscape(strings.Repeat("张", 201))} {
		call("/endpoints?"+query, admin, 400)
	}
	call("/endpoints/overview?page=1", admin, 400)
}
