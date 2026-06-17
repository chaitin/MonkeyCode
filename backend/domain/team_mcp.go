package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
)

type TeamMCPUsecase interface {
	ListUpstreams(ctx context.Context, teamUser *TeamUser) (*ListTeamMCPUpstreamsResp, error)
	CreateUpstream(ctx context.Context, teamUser *TeamUser, req CreateTeamMCPUpstreamReq) (*TeamMCPUpstream, error)
	UpdateUpstream(ctx context.Context, teamUser *TeamUser, req UpdateTeamMCPUpstreamReq) (*TeamMCPUpstream, error)
	DeleteUpstream(ctx context.Context, teamUser *TeamUser, req DeleteTeamMCPUpstreamReq) error
	SyncUpstream(ctx context.Context, teamUser *TeamUser, req SyncTeamMCPUpstreamReq) error
}

type TeamMCPRepo interface {
	ListUpstreams(ctx context.Context, teamID uuid.UUID) ([]*db.MCPUpstream, error)
	CreateUpstream(ctx context.Context, teamID uuid.UUID, req *CreateTeamMCPUpstreamReq) (*db.MCPUpstream, error)
	UpdateUpstream(ctx context.Context, teamID uuid.UUID, req *UpdateTeamMCPUpstreamReq) (*db.MCPUpstream, error)
	DeleteUpstream(ctx context.Context, teamID, upstreamID uuid.UUID) error
	GetUpstream(ctx context.Context, teamID, upstreamID uuid.UUID) (*db.MCPUpstream, error)
	HasPlatformSlug(ctx context.Context, slug string) (bool, error)
	GetMember(ctx context.Context, teamID, userID uuid.UUID) (*TeamMember, error)
}

type TeamMCPUpstream struct {
	*MCPUpstream
	TeamID uuid.UUID       `json:"team_id"`
	Groups []SkillGroupRef `json:"groups"`
}

func (m *TeamMCPUpstream) From(src *db.MCPUpstream) *TeamMCPUpstream {
	if src == nil {
		return m
	}
	m.MCPUpstream = (&MCPUpstream{}).From(src)
	if src.TeamID != nil {
		m.TeamID = *src.TeamID
	}
	m.Groups = make([]SkillGroupRef, 0, len(src.Edges.TeamGroupMcpUpstreams))
	for _, binding := range src.Edges.TeamGroupMcpUpstreams {
		if binding.Edges.Group == nil {
			continue
		}
		m.Groups = append(m.Groups, SkillGroupRef{
			ID:   binding.Edges.Group.ID.String(),
			Name: binding.Edges.Group.Name,
		})
	}
	return m
}

type ListTeamMCPUpstreamsResp struct {
	Items []*TeamMCPUpstream `json:"items"`
}

type CreateTeamMCPUpstreamReq struct {
	Name        string      `json:"name" validate:"required"`
	Slug        string      `json:"slug" validate:"required"`
	URL         string      `json:"url" validate:"required"`
	Headers     []MCPHeader `json:"headers"`
	Description string      `json:"description"`
	Enabled     *bool       `json:"enabled"`
	GroupIDs    []uuid.UUID `json:"group_ids"`
}

type UpdateTeamMCPUpstreamReq struct {
	UpstreamID  uuid.UUID    `param:"upstream_id" validate:"required" json:"-" swaggerignore:"true"`
	Name        *string      `json:"name,omitempty"`
	Slug        *string      `json:"slug,omitempty"`
	URL         *string      `json:"url,omitempty"`
	Headers     *[]MCPHeader `json:"headers,omitempty"`
	Description *string      `json:"description,omitempty"`
	Enabled     *bool        `json:"enabled,omitempty"`
	GroupIDs    []uuid.UUID  `json:"group_ids,omitempty"`
}

type DeleteTeamMCPUpstreamReq struct {
	UpstreamID uuid.UUID `param:"upstream_id" validate:"required" swaggerignore:"true"`
}

type SyncTeamMCPUpstreamReq struct {
	UpstreamID uuid.UUID `param:"upstream_id" validate:"required" swaggerignore:"true"`
}
