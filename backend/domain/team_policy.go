package domain

import (
	"fmt"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
)

type TeamTaskVMIdlePolicy struct {
	TeamID                  uuid.UUID `json:"team_id"`
	SleepEnabled            bool      `json:"sleep_enabled"`
	SleepSeconds            int       `json:"sleep_seconds"`
	EffectiveSleepSeconds   int       `json:"effective_sleep_seconds"`
	SleepInherited          bool      `json:"sleep_inherited"`
	RecycleEnabled          bool      `json:"recycle_enabled"`
	RecycleSeconds          int       `json:"recycle_seconds"`
	EffectiveRecycleSeconds int       `json:"effective_recycle_seconds"`
	RecycleInherited        bool      `json:"recycle_inherited"`
}

type UpdateTeamTaskVMIdlePolicyReq struct {
	SleepEnabled   bool `json:"sleep_enabled"`
	SleepSeconds   int  `json:"sleep_seconds"`
	RecycleEnabled bool `json:"recycle_enabled"`
	RecycleSeconds int  `json:"recycle_seconds"`
}

func ResolveTeamTaskVMIdlePolicy(team *db.Team, cfg config.VMIdle) (*TeamTaskVMIdlePolicy, error) {
	p := &TeamTaskVMIdlePolicy{
		SleepEnabled:   true,
		SleepSeconds:   0,
		RecycleEnabled: true,
		RecycleSeconds: 0,
	}
	if team != nil {
		p.TeamID = team.ID
		p.SleepEnabled = team.TaskVMSleepEnabled
		p.SleepSeconds = team.TaskVMSleepSeconds
		p.RecycleEnabled = team.TaskVMRecycleEnabled
		p.RecycleSeconds = team.TaskVMRecycleSeconds
	}
	if err := fillEffectiveTeamTaskVMIdlePolicy(p, cfg); err != nil {
		return nil, err
	}
	return p, nil
}

func NewTeamTaskVMIdlePolicyFromReq(teamID uuid.UUID, req *UpdateTeamTaskVMIdlePolicyReq, cfg config.VMIdle) (*TeamTaskVMIdlePolicy, error) {
	p := &TeamTaskVMIdlePolicy{
		TeamID:         teamID,
		SleepEnabled:   req.SleepEnabled,
		SleepSeconds:   req.SleepSeconds,
		RecycleEnabled: req.RecycleEnabled,
		RecycleSeconds: req.RecycleSeconds,
	}
	if err := fillEffectiveTeamTaskVMIdlePolicy(p, cfg); err != nil {
		return nil, err
	}
	return p, nil
}

func fillEffectiveTeamTaskVMIdlePolicy(p *TeamTaskVMIdlePolicy, cfg config.VMIdle) error {
	if p.SleepSeconds < 0 {
		return fmt.Errorf("sleep seconds must be greater than or equal to 0")
	}
	if p.RecycleSeconds < 0 {
		return fmt.Errorf("recycle seconds must be greater than or equal to 0")
	}

	if p.SleepEnabled {
		p.EffectiveSleepSeconds = p.SleepSeconds
		if p.EffectiveSleepSeconds == 0 {
			p.EffectiveSleepSeconds = cfg.SleepSeconds
			p.SleepInherited = true
		}
		if p.EffectiveSleepSeconds <= 0 {
			return fmt.Errorf("effective sleep seconds must be greater than 0")
		}
	}

	if p.RecycleEnabled {
		p.EffectiveRecycleSeconds = p.RecycleSeconds
		if p.EffectiveRecycleSeconds == 0 {
			p.EffectiveRecycleSeconds = cfg.RecycleSeconds
			p.RecycleInherited = true
		}
		if p.EffectiveRecycleSeconds <= 0 {
			return fmt.Errorf("effective recycle seconds must be greater than 0")
		}
	}

	if p.SleepEnabled && p.RecycleEnabled && p.EffectiveSleepSeconds >= p.EffectiveRecycleSeconds {
		return fmt.Errorf("effective sleep seconds must be less than effective recycle seconds")
	}
	return nil
}
