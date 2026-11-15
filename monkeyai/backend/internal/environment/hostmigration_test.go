package environment

import (
	"encoding/json"
	"maps"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestCloudMigrationReplayPreservesHostConfigurationAndScope(t *testing.T) {
	s, user, first := fixture(t)
	second := addConfiguredHost(t, s, user, first)
	resourceJSON, _ := json.Marshal(Resources{CPUMillis: 2000, MemoryBytes: 1 << 30, HostTasks: 512, TemporaryBytes: 64 << 20})
	if _, err := s.pool.Exec(t.Context(), `UPDATE host_environment_configs SET resource=$1 WHERE host_id=$2`, resourceJSON, first); err != nil {
		t.Fatal(err)
	}
	for host, limit := range map[string]int{first: 4, second: 1} {
		if _, err := s.pool.Exec(t.Context(), `INSERT INTO environment_quotas(user_id,host_id,max_environments) VALUES($1,$2,$3)`, user, host, limit); err != nil {
			t.Fatal(err)
		}
	}
	setHostAccess(t, s, first, user, []resource.Object{{"user_id": user}})
	setHostAccess(t, s, second, user, []resource.Object{})
	if _, err := s.CreateOnHost(t.Context(), user, first, Creation{"retained", "migration-replay"}); err != nil {
		t.Fatal(err)
	}
	snapshot := func() map[string]string {
		t.Helper()
		out := map[string]string{}
		for _, table := range []string{"hosts", "host_environment_configs", "host_upgrades", "environment_quotas", "environments", "environment_runtimes", "environment_operations", "environment_billing_periods", "resource_access_grants"} {
			var data string
			if err := s.pool.QueryRow(t.Context(), "SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text FROM "+table+" r").Scan(&data); err != nil {
				t.Fatal(err)
			}
			out[table] = data
		}
		return out
	}
	before := snapshot()
	for range 2 {
		if err := cloudMigration(t, s, "up"); err != nil {
			t.Fatal(err)
		}
		if !maps.Equal(before, snapshot()) {
			t.Fatal("重放38覆盖宿主配置、个人配额、授权或已有环境")
		}
	}
	allowed, err := resource.Allowed(t.Context(), s.pool, "host", second, user)
	if err != nil || allowed {
		t.Fatal("重放扩大了未授权宿主范围", err)
	}
	if err := cloudMigration(t, s, "down"); err == nil {
		t.Fatal("已有环境仍允许回退")
	}
	if !maps.Equal(before, snapshot()) {
		t.Fatal("失败回退改变云环境状态或授权")
	}
}

func TestHostGrantsRejectMalformedOrDuplicateSubjects(t *testing.T) {
	id := resource.ID()
	for _, grants := range [][]resource.Object{
		{{"user_id": "invalid"}}, {{"user_id": id, "group_id": id}}, {{"all_users": true, "user_id": id}},
		{{"user_id": id}, {"user_id": id}}, {{"all_users": true, "usage_requirement": "required"}},
	} {
		if validateHostGrants(grants) == nil {
			t.Fatal("接受非法宿主授权", grants)
		}
	}
	if !sameHostGrants([]resource.Object{{"all_users": true}}, []resource.Object{{"group_id": "00000000-0000-0000-0000-000000000000", "usage_requirement": "optional"}}) {
		t.Fatal("全员授权的读取表示破坏幂等")
	}
}
