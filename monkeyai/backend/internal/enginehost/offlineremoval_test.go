package enginehost

import (
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"testing"
)

func TestRemoveUninstalledHost(t *testing.T) {
	db := testPool(t)
	host := resource.ID()
	exec := func(query string) {
		t.Helper()
		if _, err := db.Exec(t.Context(), query, host); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(t.Context(), "INSERT INTO hosts(id,user_id,name,architecture,version,status,last_seen_at) VALUES($1,$2,'已卸载','amd64','v1','active',now())", host, testAdmin); err != nil {
		t.Fatal(err)
	}
	exec("INSERT INTO environments(id,user_id,host_id,name,generation,instance_id,desired,spec,cpu_millis,memory_bytes,archived_at) SELECT gen_random_uuid(),user_id,id,'归档',2,gen_random_uuid(),'deleted','{}',1,1,now() FROM hosts WHERE id=$1")
	r := chi.NewRouter()
	registerAdmin(r, NewService(db))
	remove := func(want int) {
		t.Helper()
		w := call(r, "DELETE", "/engine-hosts/"+host+"/record", nil)
		if w.Code != want {
			t.Fatal(w.Code, w.Body)
		}
	}
	remove(409)
	exec("UPDATE hosts SET last_seen_at=now()-interval '2 minutes' WHERE id=$1")
	exec("INSERT INTO environments(id,user_id,host_id,name,generation,instance_id,desired,spec,cpu_millis,memory_bytes) SELECT gen_random_uuid(),user_id,id,'保留',1,gen_random_uuid(),'stopped','{}',1,1 FROM hosts WHERE id=$1")
	remove(409)
	exec("UPDATE environments SET desired='deleted',archived_at=now() WHERE host_id=$1 AND desired='stopped'")
	remove(204)
	remove(204)
}
