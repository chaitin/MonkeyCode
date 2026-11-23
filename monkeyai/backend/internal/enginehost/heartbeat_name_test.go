package enginehost

import (
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/enginehost/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"testing"
	"time"
)

func TestHeartbeatFillsOnlyEmptyName(t *testing.T) {
	db := testPool(t)
	ctx := t.Context()
	host := resource.ID()
	if _, err := db.Exec(ctx, "INSERT INTO hosts(id,user_id,name,architecture,version,status) VALUES($1,$2,'测试宿主','amd64','v1','active')", host, testAdmin); err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC()
	for _, want := range []string{"测试宿主", "node-01"} {
		if want == "node-01" {
			if _, err := db.Exec(ctx, "UPDATE hosts SET name='' WHERE id=$1", host); err != nil {
				t.Fatal(err)
			}
		}
		at = at.Add(time.Second)
		n, err := sqlc.New(db).RecordHeartbeat(ctx, sqlc.RecordHeartbeatParams{Candidate: "node-01", ID: host, At: at, Report: []byte(`{"system":{"hostname":"node-01"}}`)})
		if n != 1 || err != nil {
			t.Fatalf("心跳未保存：%d，%v", n, err)
		}
		var name string
		if err := db.QueryRow(ctx, "SELECT name FROM hosts WHERE id=$1", host).Scan(&name); err != nil || name != want {
			t.Fatalf("心跳后名称 %q，期望 %q：%v", name, want, err)
		}
	}
}
