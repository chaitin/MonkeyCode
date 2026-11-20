package identity

import (
	"github.com/jackc/pgx/v5"
	"testing"
	"uuid"
)

func TestLegacyCloudRuntimeDeniedWithoutModule(t *testing.T) {
	s, user, _, _ := deviceService(t)
	ctx := t.Context()
	host, env, cloud, local := uuid.New().String(), uuid.New().String(), uuid.New().String(), uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "INSERT INTO hosts(id,user_id,name,status,architecture,version) VALUES($1,$2,'host','revoked','amd64','test')", host, user.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO environments(id,user_id,host_id,name,generation,instance_id,desired,spec,cpu_millis,memory_bytes) VALUES($1,$2,$3,'test',1,$1,'stopped','{}',1,1)`, env, user.ID, host); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, "INSERT INTO environment_runtimes(environment_id,machine_id,public_key,instance_id,generation) VALUES($1,$2,$3,$1,1)", env, cloud, make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	check := func(tx pgx.Tx) {
		t.Helper()
		for id, want := range map[string]bool{cloud: false, local: true} {
			got, err := s.runtimeAllowed(ctx, tx, user.ID, id)
			if err != nil || got != want {
				t.Fatalf("机器 %s: allowed=%v err=%v", id, got, err)
			}
		}
	}
	check(tx)
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	check(nil)
}
