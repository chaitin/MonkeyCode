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
	host, preset, env, instance := uuid.New().String(), uuid.New().String(), uuid.New().String(), uuid.New().String()
	key := bytes.Repeat([]byte{1}, 32)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO endpoints(user_id,machine_id,device_name,platform,os_version,arch,client_version,protocol_version,execution_public_key,key_id) VALUES($1,$2,'MonkeyAI Cloud','linux','Ubuntu 24.04','amd64','1',1,$3,$4)`, user, machine, key, KeyID(key))
	exec(`INSERT INTO endpoints(user_id,machine_id,device_name,platform,os_version,arch,client_version,protocol_version) VALUES($1,$2,'本地电脑','macos','15.0','arm64','1',1)`, user, local)
	exec(`INSERT INTO engine_hosts(id,name,architecture,version,status,enrollment_hash,enrollment_expires_at) VALUES($1,'测试宿主','amd64','v1','active','hash',now()+interval '1 hour')`, host)
	exec(`INSERT INTO environment_presets(id,name,architecture,configuration,cpu_millis,memory_bytes,storage_bytes) VALUES($1,'测试预设','amd64','{}',1000,1024,0)`, preset)
	exec(`INSERT INTO environments(id,user_id,host_id,preset_id,name,generation,instance_id,desired,spec,cpu_millis,memory_bytes,storage_bytes,request_key,request_hash) VALUES($1,$2,$3,$4,'云环境任务验证',1,$5,'running','{}',1000,1024,0,'test','hash')`, env, user, host, preset, instance)
	exec(`INSERT INTO environment_runtime(environment_id,machine_id,public_key,instance_id,generation,request_id) VALUES($1,$2,$3,$4,1,$5)`, env, machine, key, instance, uuid.New().String())
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
	updated, err := store.Update(ctx, user, machine, "rename", &alias, 20)
	if err != nil || updated.DisplayName != alias {
		t.Fatalf("别名写入=%+v %v", updated, err)
	}
	check(alias)
	_, err = store.Update(ctx, user, machine, "rename", nil, 20)
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
	exec(`UPDATE environment_runtime SET public_key=$2 WHERE environment_id=$1`, env, bytes.Repeat([]byte{2}, 32))
	check("MonkeyAI Cloud")
}
