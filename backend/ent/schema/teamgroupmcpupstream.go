package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type TeamGroupMCPUpstream struct {
	ent.Schema
}

func (TeamGroupMCPUpstream) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("team_group_mcp_upstreams"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

func (TeamGroupMCPUpstream) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("team_id", uuid.UUID{}),
		field.UUID("group_id", uuid.UUID{}),
		field.UUID("upstream_id", uuid.UUID{}),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (TeamGroupMCPUpstream) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("group_id", "upstream_id").Unique(),
		index.Fields("team_id"),
		index.Fields("group_id"),
	}
}

func (TeamGroupMCPUpstream) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("team", Team.Type).Field("team_id").Unique().Required(),
		edge.To("group", TeamGroup.Type).Field("group_id").Unique().Required(),
		edge.To("upstream", MCPUpstream.Type).Field("upstream_id").Unique().Required(),
	}
}
