package enginehost

import (
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestHostDeletionPreservesUnfinishedUpgrade(t *testing.T) {
	db := testPool(t)
	s := NewService(db)
	router := chi.NewRouter()
	registerAdmin(router, s)
	host, job := resource.ID(), resource.ID()
	if _, err := db.Exec(t.Context(), "INSERT INTO hosts(id,user_id,name,architecture,version,status) VALUES($1,$2,'upgrading','amd64','v1','active')", host, testAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(t.Context(), `INSERT INTO host_upgrades(id,host_id,from_version,target_version,installer_sha256,manifest_sha256) VALUES($1,$2,'v1','v2',$3,$3)`, job, host, strings.Repeat("a", 64)); err != nil {
		t.Fatal(err)
	}
	path := "/engine-hosts/" + host + "/record"
	if w := call(router, "DELETE", path, nil); w.Code != 409 {
		t.Fatal("删除仍在升级的宿主", w.Code)
	}
	if _, err := db.Exec(t.Context(), "UPDATE host_upgrades SET status='failed',reason='upgrade_failed' WHERE id=$1", job); err != nil {
		t.Fatal(err)
	}
	if w := call(router, "DELETE", path, nil); w.Code != 204 {
		t.Fatal("升级结束后不能删除宿主", w.Code)
	}
	var retained bool
	if err := db.QueryRow(t.Context(), "SELECT from_version='v1' AND target_version='v2' AND status='failed' FROM host_upgrades WHERE id=$1", job).Scan(&retained); err != nil || !retained {
		t.Fatal("宿主删除清理升级历史", err)
	}
}
