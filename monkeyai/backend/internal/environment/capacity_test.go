package environment

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
)

func TestCapacityAllowsResourceOversellingAndLimitsCount(t *testing.T) {
	s, user, host, in := setupFixture(t)
	ctx := t.Context()
	in.Resource.CPUMillis = 4000
	in.Resource.MemoryBytes = 8 << 30
	in.MaxEnvironments = 3
	in.UserMaxEnvironments = 3
	if _, err := s.saveSetup(ctx, host, in); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE hosts SET report=jsonb_set(jsonb_set(report,'{system,cpu,logical_cores}','1'),'{system,memory,total_bytes}','1073741824') WHERE id=$1`, host); err != nil {
		t.Fatal(err)
	}
	first, err := s.Create(ctx, user, Creation{"one", "over-one"})
	if err != nil {
		t.Fatal("单环境规格超过物理容量仍应允许分配", err)
	}
	for _, key := range []string{"over-two", "over-three"} {
		if _, err := s.Create(ctx, user, Creation{key, key}); err != nil {
			t.Fatal("总规格超卖被拒绝", err)
		}
	}
	if _, err := s.Create(ctx, user, Creation{"full", "over-four"}); err == nil {
		t.Fatal("超过数量上限")
	}
	stop, err := s.Change(ctx, &user, first.Environment.ID, "stopped", Change{1, "stop"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(stop.Environment, "stopped"))
	if _, err := s.Create(ctx, user, Creation{"still-full", "over-five"}); err == nil {
		t.Fatal("停止环境错误释放数量")
	}
	in.MaxEnvironments = 1
	in.UserMaxEnvironments = 1
	if _, err := s.saveSetup(ctx, host, in); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Change(ctx, &user, first.Environment.ID, "running", Change{2, "restart"}); err != nil {
		t.Fatal("已占名额环境重启不应重新申请数量", err)
	}
	if _, err := sqlc.New(s.pool).SetScheduling(ctx, sqlc.SetSchedulingParams{HostID: host, Enabled: false}); err != nil {
		t.Fatal(err)
	}
	current, err := sqlc.New(s.pool).GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: first.Environment.ID})
	if err != nil || current.Desired != "running" {
		t.Fatal("关闭调度或降低上限停止了原环境", err)
	}
}
