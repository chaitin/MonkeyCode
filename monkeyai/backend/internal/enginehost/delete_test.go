package enginehost

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestDeleteHost(t *testing.T) {
	pool := testPool(t)
	s := NewService(pool)
	r := chi.NewRouter()
	s.RegisterAdmin(r)
	s.Register(r)
	exec := func(t *testing.T, query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(t.Context(), query, args...); err != nil {
			t.Fatal(err)
		}
	}
	migration, err := os.ReadFile("../../migrations/000040_engine_host_deletion.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec(t, string(migration))
	user, preset := resource.ID(), resource.ID()
	exec(t, `INSERT INTO users(id,name,email) VALUES($1,'删除测试','delete-host@example.test')`, user)
	exec(t, `INSERT INTO environment_presets(id,name,architecture,configuration,cpu_millis,memory_bytes,storage_bytes) VALUES($1,'测试','amd64','{}',1,1,0)`, preset)
	for _, status := range []string{"pending", "active", "revoked"} {
		t.Run(status, func(t *testing.T) {
			id := resource.ID()
			exec(t, `INSERT INTO engine_hosts(id,name,architecture,version,status,enrollment_hash,enrollment_expires_at) VALUES($1,'测试宿主','amd64','v1',$2,$3,now()+interval '1 hour')`, id, status, "delete-"+id)
			exec(t, `INSERT INTO environment_hosts(host_id,enabled,cpu_millis,memory_bytes,storage_bytes,max_environments) VALUES($1,true,1,1,0,1)`, id)
			path := "/engine-hosts/" + id + "/record"
			if status == "active" {
				env := resource.ID()
				exec(t, `INSERT INTO environments(id,user_id,host_id,preset_id,name,generation,instance_id,desired,spec,cpu_millis,memory_bytes,storage_bytes,request_key,request_hash) VALUES($1,$2,$3,$4,'环境',2,$1,'running','{}',1,1,0,'delete-test','test')`, env, user, id, preset)
				for _, state := range [][3]any{{"running", "running", 2}, {"stopped", "stopped", 2}, {"deleted", "deleting", 2}, {"deleted", "failed", 2}, {"deleted", "deleted", 1}} {
					exec(t, `UPDATE environments SET desired=$2,phase=$3,observed_generation=$4 WHERE id=$1`, env, state[0], state[1], state[2])
					if w := call(r, "DELETE", path, nil); w.Code != 409 {
						t.Fatalf("未阻止删除仍有关联环境的宿主 %+v: %d %s", state, w.Code, w.Body)
					}
					var current string
					if err := pool.QueryRow(t.Context(), `SELECT status FROM engine_hosts WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&current); err != nil || current != "active" {
						t.Fatalf("删除失败改变宿主状态: %s %v", current, err)
					}
				}
				exec(t, `UPDATE environments SET observed_generation=generation WHERE id=$1`, env)
			}
			for range 2 {
				if w := call(r, "DELETE", path, nil); w.Code != 204 {
					t.Fatalf("删除失败: %d %s", w.Code, w.Body)
				}
			}
			var disabled bool
			if err := pool.QueryRow(t.Context(), `SELECT h.status='revoked' AND h.deleted_at IS NOT NULL AND NOT e.enabled FROM engine_hosts h JOIN environment_hosts e ON e.host_id=h.id WHERE h.id=$1`, id).Scan(&disabled); err != nil || !disabled {
				t.Fatalf("删除没有撤销接入、停用调度: %v", err)
			}
			if w := call(r, "POST", "/api/host/v1/challenges", map[string]string{"host_id": id}); w.Code != 401 {
				t.Fatal("已删除宿主仍能认证")
			}
			if w := call(r, "DELETE", "/engine-hosts/"+id, nil); w.Code != 404 {
				t.Fatal("旧撤销接口不应修改已删除宿主")
			}
		})
	}
	exec(t, string(migration))
	listed := call(r, "GET", "/engine-hosts", nil)
	var out struct {
		Total int
		Items []json.RawMessage
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &out); err != nil || out.Total != 0 || len(out.Items) != 0 {
		t.Fatalf("已删除宿主仍在列表中: %s %v", listed.Body, err)
	}
	if w := call(r, "DELETE", "/engine-hosts/"+resource.ID()+"/record", nil); w.Code != 204 {
		t.Fatal("删除不存在的记录应幂等")
	}
	if w := call(r, "DELETE", "/engine-hosts/invalid/record", nil); w.Code != 404 {
		t.Fatal("未拒绝无效宿主 ID")
	}
}
