package environment

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
)

func TestCapacityAllowsResourceOversellingWithoutCountLimits(t *testing.T) {
	s, user, host, in := setupFixture(t)
	ctx := t.Context()
	if _, err := s.pool.Exec(ctx, "UPDATE environment_specifications SET cpu_millis=4000,memory_bytes=$1 WHERE id=$2", int64(8<<30), testSpecification().SpecificationID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.saveSetup(ctx, host, in); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE hosts SET report=jsonb_set(jsonb_set(report,'{system,cpu,logical_cores}','1'),'{system,memory,total_bytes}','1073741824') WHERE id=$1`, host); err != nil {
		t.Fatal(err)
	}
	first, err := s.Create(ctx, user, Creation{testSpecification(), "one", "over-one"})
	if err != nil {
		t.Fatal("单环境规格超过物理容量仍应允许分配", err)
	}
	for _, key := range []string{"over-two", "over-three"} {
		if _, err := s.Create(ctx, user, Creation{testSpecification(), key, key}); err != nil {
			t.Fatal("总规格超卖被拒绝", err)
		}
	}
	if _, err := s.Create(ctx, user, Creation{testSpecification(), "full", "over-four"}); err != nil {
		t.Fatal("不应有数量上限", err)
	}
	stop, err := s.Change(ctx, &user, first.Environment.ID, "stopped", Change{1, "stop"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(stop.Environment, "stopped"))
	if _, err := s.Create(ctx, user, Creation{testSpecification(), "still-full", "over-five"}); err != nil {
		t.Fatal("停止环境不应阻止新建", err)
	}
	if _, err := s.saveSetup(ctx, host, in); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Change(ctx, &user, first.Environment.ID, "running", Change{2, "restart"}); err != nil {
		t.Fatal("已有环境应能重启", err)
	}
	if _, err := sqlc.New(s.pool).SetScheduling(ctx, sqlc.SetSchedulingParams{HostID: host, Enabled: false}); err != nil {
		t.Fatal(err)
	}
	current, err := sqlc.New(s.pool).GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: first.Environment.ID})
	if err != nil || current.Desired != "running" {
		t.Fatal("关闭调度停止了原环境", err)
	}
}
