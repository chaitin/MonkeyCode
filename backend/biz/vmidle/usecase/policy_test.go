package usecase

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestVMIdleSchedulePlanFromPolicy(t *testing.T) {
	policy := &domain.TeamTaskVMIdlePolicy{
		TeamID:                  uuid.New(),
		SleepEnabled:            false,
		EffectiveSleepSeconds:   0,
		RecycleEnabled:          true,
		EffectiveRecycleSeconds: 3600,
	}
	schedules := []notifySchedule{{name: "default", lead: 600 * time.Second, leadSeconds: 600}}

	got := buildVMIdleSchedulePlan(policy, schedules)
	if got.SleepAt != nil {
		t.Fatalf("sleep should be disabled: %#v", got.SleepAt)
	}
	if got.RecycleAt == nil {
		t.Fatal("recycle should be scheduled")
	}
	if len(got.NotifyJobs) != 1 || got.NotifyJobs[0].MemberSuffix != "default" {
		t.Fatalf("notify jobs = %#v", got.NotifyJobs)
	}
}

func TestResolvePolicyForVMFallsBackToGlobalWhenTeamMissing(t *testing.T) {
	r := &vmIdleRefresher{
		cfg: &config.Config{VMIdle: config.VMIdle{SleepSeconds: 600, RecycleSeconds: 604800}},
	}
	vm := &db.VirtualMachine{ID: "vm-1"}

	got, err := r.resolvePolicyForVM(context.Background(), vm)
	if err != nil {
		t.Fatal(err)
	}
	if !got.SleepEnabled || got.EffectiveSleepSeconds != 600 {
		t.Fatalf("sleep policy = %#v", got)
	}
	if !got.RecycleEnabled || got.EffectiveRecycleSeconds != 604800 {
		t.Fatalf("recycle policy = %#v", got)
	}
}
