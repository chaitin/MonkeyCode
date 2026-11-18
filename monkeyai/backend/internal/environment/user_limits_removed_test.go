package environment

import (
	"os"
	"testing"
)

func TestUserLimitsMigrationRemovesOnlyPersonalLimits(t *testing.T) {
	s, user, host := fixture(t)
	ctx := t.Context()
	apply := func(direction string) {
		t.Helper()
		raw, err := os.ReadFile("../../migrations/000050_remove_environment_user_limits." + direction + ".sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.pool.Exec(ctx, string(raw)); err != nil {
			t.Fatal(err)
		}
	}
	apply("down")
	if _, err := s.pool.Exec(ctx, "UPDATE host_environment_configs SET user_max_environments=0 WHERE host_id=$1", host); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, "INSERT INTO environment_quotas(host_id,user_id,max_environments) VALUES($1,$2,0)", host, user); err != nil {
		t.Fatal(err)
	}
	apply("up")
	var removed bool
	if err := s.pool.QueryRow(ctx, `SELECT to_regclass('environment_quotas') IS NULL AND NOT EXISTS (
 SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='host_environment_configs' AND column_name='user_max_environments')`).Scan(&removed); err != nil || !removed {
		t.Fatal("个人配额结构未删除", removed, err)
	}
	var configs int
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM host_environment_configs WHERE host_id=$1", host).Scan(&configs); err != nil || configs != 1 {
		t.Fatal("迁移删除了宿主配置", configs, err)
	}
}
