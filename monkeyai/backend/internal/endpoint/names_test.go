package endpoint

import (
	"bytes"
	"testing"
	"uuid"
)

func TestCloudDeviceNames(t *testing.T) {
	db := testDatabase(t)
	ctx := t.Context()
	user := testUser(t, db, "cloud-owner")
	other := testUser(t, db, "other-owner")
	machine, local := uuid.New().String(), uuid.New().String()
	host, env, instance := uuid.New().String(), uuid.New().String(), uuid.New().String()
	key := bytes.Repeat([]byte{1}, 32)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO endpoints(user_id,machine_id,device_name,platform,os_version,arch,client_version,protocol_version,execution_public_key,key_id) VALUES($1,$2,'MonkeyAI Cloud','linux','Ubuntu 24.04','amd64','1',1,$3,$4)`, user, machine, key, KeyID(key))
	exec(`INSERT INTO endpoints(user_id,machine_id,device_name,platform,os_version,arch,client_version,protocol_version) VALUES($1,$2,'本地电脑','macos','15.0','arm64','1',1)`, user, local)
	exec(`INSERT INTO hosts(id,user_id,name,architecture,version,status) VALUES($1,$2,'测试宿主','amd64','v1','active')`, host, user)
	exec(`INSERT INTO environments(id,user_id,host_id,name,generation,instance_id,desired,spec,cpu_millis,memory_bytes) VALUES($1,$2,$3,'云环境任务验证',1,$4,'running','{}',1000,1024)`, env, user, host, instance)
	exec(`INSERT INTO environment_runtimes(environment_id,machine_id,public_key,instance_id,generation) VALUES($1,$2,$3,$4,1)`, env, machine, key, instance)
	store := NewPostgres(db)
	execution := NewExecution(db, nil)
	check := func(want string) {
		t.Helper()
		got, err := store.Get(ctx, user, machine)
		if err != nil || got.DisplayName != want || got.DeviceName != "MonkeyAI Cloud" {
			t.Fatalf("详情名称=%q want=%q err=%v", got.DisplayName, want, err)
		}
		page, err := store.Page(ctx, user, 1, 20)
		if err != nil {
			t.Fatal(err)
		}
		active, err := store.Active(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		for _, items := range [][]Endpoint{page.Items, active} {
			for _, item := range items {
				if item.MachineID == machine && item.DisplayName != want {
					t.Fatal(item)
				}
				if item.MachineID == local && item.DisplayName != "本地电脑" {
					t.Fatal(item)
				}
			}
		}
		rows, err := execution.Snapshot(ctx, user, true)
		if err != nil || len(rows) != 1 || rows[0].DisplayName != want {
			t.Fatalf("执行设备列表=%+v err=%v", rows, err)
		}
	}
	check("云环境任务验证")
	alias := "我的开发环境"
	updated, err := store.Update(ctx, user, machine, "rename", &alias)
	if err != nil || updated.DisplayName != alias {
		t.Fatalf("别名写入=%+v %v", updated, err)
	}
	check(alias)
	_, err = store.Update(ctx, user, machine, "rename", nil)
	if err != nil {
		t.Fatal(err)
	}
	check("云环境任务验证")
	exec(`UPDATE environments SET desired='deleted',phase='deleted' WHERE id=$1`, env)
	check("云环境任务验证")
	exec(`UPDATE endpoints SET device_name='MonkeyAI Cloud' WHERE user_id=$1 AND machine_id=$2`, user, machine)
	check("云环境任务验证")
	exec(`UPDATE environments SET user_id=$2 WHERE id=$1`, env, other)
	check("MonkeyAI Cloud")
	exec(`UPDATE environments SET user_id=$2 WHERE id=$1`, env, user)
	exec(`UPDATE environment_runtimes SET public_key=$2 WHERE environment_id=$1`, env, bytes.Repeat([]byte{2}, 32))
	check("MonkeyAI Cloud")
}
