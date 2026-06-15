package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

type TeamSkillUsecase interface {
	Add(ctx context.Context, teamUser *TeamUser, req *AddTeamSkillReq) (*TeamSkill, error)
	AddPackage(ctx context.Context, teamUser *TeamUser, req *AddTeamSkillPackageReq) (*TeamSkill, error)
	List(ctx context.Context, teamUser *TeamUser) (*ListTeamSkillsResp, error)
	Update(ctx context.Context, teamUser *TeamUser, req *UpdateTeamSkillReq) (*TeamSkill, error)
	Delete(ctx context.Context, teamUser *TeamUser, req *DeleteTeamSkillReq) error
}

// UserSkillUsecase powers the user-facing /api/v1/skills picker and the
// task-dispatch skill resolution path. Both surfaces are scoped to the
// requesting user's active team and rewrite skill artifacts with short-lived
// presigned GET URLs.
type UserSkillUsecase interface {
	List(ctx context.Context, user *User) (*ListTeamSkillsResp, error)
	// Refs resolves the requested skill IDs against the user's active team
	// and returns one entry per matched skill carrying the presigned zip URL.
	// IDs that don't belong to the user's team or have no package are
	// silently dropped (task creation must not fail on a stale picker).
	Refs(ctx context.Context, user *User, skillIDs []uuid.UUID) ([]SkillRef, error)
}

// SkillRef is the agent-dispatch view of a skill: a presigned download URL
// plus the metadata the agent needs to register the skill in-VM.
type SkillRef struct {
	Name          string
	ZipURL        string
	EntryFilename string
}

type TeamSkillRepo interface {
	List(ctx context.Context, teamID uuid.UUID) ([]*db.Skill, error)
	Create(ctx context.Context, teamID, userID uuid.UUID, req *AddTeamSkillReq) (*db.Skill, error)
	Update(ctx context.Context, teamID uuid.UUID, req *UpdateTeamSkillReq) (*db.Skill, error)
	Delete(ctx context.Context, teamID, skillID uuid.UUID) error
}

type TeamSkill struct {
	ID          uuid.UUID    `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Tags        []string     `json:"tags"`
	Content     string       `json:"content"`
	PackageKey  string       `json:"package_object_key,omitempty"`
	PackageURL  string       `json:"package_url,omitempty"`
	Groups      []*TeamGroup `json:"groups"`
	SourceType  string       `json:"source_type"`
	SourceLabel string       `json:"source_label"`
	SkillMDPath string       `json:"skill_md_path,omitempty"`
	CreatedAt   int64        `json:"created_at"`
	UpdatedAt   int64        `json:"updated_at"`
}

func (t *TeamSkill) From(src *db.Skill) *TeamSkill {
	if src == nil {
		return t
	}

	t.ID = src.ID
	t.Name = src.Name
	t.Description = src.Description
	t.Tags = src.Tags
	t.Content = src.Content
	t.PackageKey = src.PackageObjectKey
	t.PackageURL = src.PackageURL
	t.SourceType = src.SourceType
	t.SourceLabel = src.SourceLabel
	t.SkillMDPath = src.SkillMdPath
	t.Groups = cvt.Iter(src.Edges.Groups, func(_ int, g *db.TeamGroup) *TeamGroup {
		return cvt.From(g, &TeamGroup{})
	})
	t.CreatedAt = src.CreatedAt.Unix()
	t.UpdatedAt = src.UpdatedAt.Unix()
	return t
}

type AddTeamSkillReq struct {
	Name             string      `json:"name" form:"name" validate:"required"`
	Description      string      `json:"description" form:"description" validate:"required"`
	Tags             []string    `json:"tags" validate:"omitempty"`
	Content          string      `json:"content" form:"content" validate:"required"`
	PackageObjectKey string      `json:"package_object_key,omitempty" swaggerignore:"true"`
	PackageURL       string      `json:"package_url,omitempty" swaggerignore:"true"`
	GroupIDs         []uuid.UUID `json:"group_ids" validate:"omitempty"`
	SourceType       string      `json:"source_type" form:"source_type" validate:"required"`
	SourceLabel      string      `json:"source_label" form:"source_label" validate:"required"`
	SkillMDPath      string      `json:"skill_md_path" form:"skill_md_path" validate:"omitempty"`
}

type AddTeamSkillPackageReq struct {
	AddTeamSkillReq
	PackageFilename string `json:"-" swaggerignore:"true"`
	PackageData     []byte `json:"-" swaggerignore:"true"`
}

type ListTeamSkillsResp struct {
	Skills []*TeamSkill `json:"skills"`
}

type UpdateTeamSkillReq struct {
	SkillID     uuid.UUID   `param:"skill_id" validate:"required" json:"-" swaggerignore:"true"`
	Name        string      `json:"name" validate:"omitempty"`
	Description string      `json:"description" validate:"omitempty"`
	Tags        []string    `json:"tags" validate:"omitempty"`
	Content     string      `json:"content" validate:"omitempty"`
	GroupIDs    []uuid.UUID `json:"group_ids" validate:"omitempty"`
	SourceType  string      `json:"source_type" validate:"omitempty"`
	SourceLabel string      `json:"source_label" validate:"omitempty"`
	SkillMDPath *string     `json:"skill_md_path,omitempty" validate:"omitempty"`
}

type DeleteTeamSkillReq struct {
	SkillID uuid.UUID `param:"skill_id" validate:"required" json:"-" swaggerignore:"true"`
}
