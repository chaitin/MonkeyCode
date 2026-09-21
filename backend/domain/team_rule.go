package domain

import (
	"context"

	"github.com/google/uuid"
)

// TeamRule is the admin DTO for an enterprise global rule.
type TeamRule struct {
	ID            uuid.UUID `json:"id"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	Content       string    `json:"content"`
	Enabled       bool      `json:"enabled"`
	ActiveVersion string    `json:"active_version,omitempty"`
	CreatedAt     int64     `json:"created_at"`
	UpdatedAt     int64     `json:"updated_at"`
}

type TeamRuleVersion struct {
	ID        uuid.UUID `json:"id"`
	Version   string    `json:"version"`
	CreatedAt int64     `json:"created_at"`
}

type ListTeamRulesResp struct {
	Rules []*TeamRule `json:"rules"`
}

type ListTeamRuleVersionsResp struct {
	Versions []*TeamRuleVersion `json:"versions"`
}

type AddTeamRuleReq struct {
	Name        string `json:"name" validate:"required"`
	Description string `json:"description"`
	Content     string `json:"content" validate:"required"`
}

type UpdateTeamRuleReq struct {
	RuleID      uuid.UUID `param:"rule_id" validate:"required" json:"-" swaggerignore:"true"`
	Name        string    `json:"name" validate:"omitempty"`
	Description *string   `json:"description" validate:"omitempty"`
	Content     string    `json:"content" validate:"omitempty"`
}

type SetTeamRuleEnabledReq struct {
	RuleID  uuid.UUID `param:"rule_id" validate:"required" json:"-" swaggerignore:"true"`
	Enabled bool      `json:"enabled"`
}

type DeleteTeamRuleReq struct {
	RuleID uuid.UUID `param:"rule_id" validate:"required" json:"-" swaggerignore:"true"`
}

type ListTeamRuleVersionsReq struct {
	RuleID uuid.UUID `param:"rule_id" validate:"required" json:"-" swaggerignore:"true"`
}

type RestoreTeamRuleReq struct {
	RuleID    uuid.UUID `param:"rule_id" validate:"required" json:"-" swaggerignore:"true"`
	VersionID uuid.UUID `json:"version_id" validate:"required"`
}

// TeamRuleUsecase is the /manager global-rule CRUD surface.
// Enable/disable does not create a new content version. Soft-deleted
// rules stay out of ListActiveRules so later Create-path tasks are
// not injected (G2-MOUNT-001 / AC-MOUNT-006).
type TeamRuleUsecase interface {
	List(ctx context.Context, teamUser *TeamUser) (*ListTeamRulesResp, error)
	Add(ctx context.Context, teamUser *TeamUser, req *AddTeamRuleReq) (*TeamRule, error)
	Update(ctx context.Context, teamUser *TeamUser, req *UpdateTeamRuleReq) (*TeamRule, error)
	SetEnabled(ctx context.Context, teamUser *TeamUser, req *SetTeamRuleEnabledReq) (*TeamRule, error)
	Delete(ctx context.Context, teamUser *TeamUser, req *DeleteTeamRuleReq) error
	ListVersions(ctx context.Context, teamUser *TeamUser, req *ListTeamRuleVersionsReq) (*ListTeamRuleVersionsResp, error)
	Restore(ctx context.Context, teamUser *TeamUser, req *RestoreTeamRuleReq) (*TeamRule, error)
}
