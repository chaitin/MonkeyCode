package domain

import (
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
)

func TestResolveTeamTaskVMIdlePolicyInheritsGlobalDefaults(t *testing.T) {
	team := &db.Team{
		ID:                   uuid.New(),
		TaskVMSleepEnabled:   true,
		TaskVMSleepSeconds:   0,
		TaskVMRecycleEnabled: true,
		TaskVMRecycleSeconds: 0,
	}

	got, err := ResolveTeamTaskVMIdlePolicy(team, config.VMIdle{
		SleepSeconds:   600,
		RecycleSeconds: 604800,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !got.SleepEnabled || got.SleepSeconds != 0 || got.EffectiveSleepSeconds != 600 || !got.SleepInherited {
		t.Fatalf("sleep policy = %#v", got)
	}
	if !got.RecycleEnabled || got.RecycleSeconds != 0 || got.EffectiveRecycleSeconds != 604800 || !got.RecycleInherited {
		t.Fatalf("recycle policy = %#v", got)
	}
}

func TestResolveTeamTaskVMIdlePolicyCanDisableQueues(t *testing.T) {
	team := &db.Team{
		ID:                   uuid.New(),
		TaskVMSleepEnabled:   false,
		TaskVMSleepSeconds:   1200,
		TaskVMRecycleEnabled: false,
		TaskVMRecycleSeconds: 86400,
	}

	got, err := ResolveTeamTaskVMIdlePolicy(team, config.VMIdle{
		SleepSeconds:   600,
		RecycleSeconds: 604800,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.SleepEnabled || got.EffectiveSleepSeconds != 0 {
		t.Fatalf("sleep policy = %#v", got)
	}
	if got.RecycleEnabled || got.EffectiveRecycleSeconds != 0 {
		t.Fatalf("recycle policy = %#v", got)
	}
}

func TestResolveTeamTaskVMIdlePolicyRejectsInvalidDurations(t *testing.T) {
	cases := []struct {
		name string
		team *db.Team
	}{
		{
			name: "negative sleep",
			team: &db.Team{TaskVMSleepEnabled: true, TaskVMSleepSeconds: -1, TaskVMRecycleEnabled: true, TaskVMRecycleSeconds: 604800},
		},
		{
			name: "negative recycle",
			team: &db.Team{TaskVMSleepEnabled: true, TaskVMSleepSeconds: 600, TaskVMRecycleEnabled: true, TaskVMRecycleSeconds: -1},
		},
		{
			name: "sleep not less than recycle",
			team: &db.Team{TaskVMSleepEnabled: true, TaskVMSleepSeconds: 3600, TaskVMRecycleEnabled: true, TaskVMRecycleSeconds: 3600},
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := ResolveTeamTaskVMIdlePolicy(tt.team, config.VMIdle{SleepSeconds: 600, RecycleSeconds: 604800}); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}
