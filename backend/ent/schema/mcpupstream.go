package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"
)

type MCPUpstream struct {
	ent.Schema
}

func (MCPUpstream) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("mcp_upstreams"),
	}
}

func (MCPUpstream) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.String("name").NotEmpty().MaxLen(128),
		field.String("slug").NotEmpty().MaxLen(64),
		field.String("scope").NotEmpty().MaxLen(16).Default("platform"),
		field.UUID("user_id", uuid.UUID{}).Optional().Nillable(),
		field.String("type").NotEmpty().MaxLen(16).Default("server"),
		field.Text("url").NotEmpty(),
		field.JSON("headers", map[string]string{}).Optional(),
		field.Text("description").Optional(),
		field.Bool("enabled").Default(true),
		field.String("health_status").NotEmpty().MaxLen(16).Default("unknown"),
		field.String("sync_status").NotEmpty().MaxLen(16).Default("pending"),
		field.Time("health_checked_at").Optional().Nillable(),
		field.Time("last_synced_at").Optional().Nillable(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (MCPUpstream) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("scope", "user_id", "slug").Unique(),
	}
}
