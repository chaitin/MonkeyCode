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

type MCPTool struct {
	ent.Schema
}

func (MCPTool) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("mcp_tools"),
	}
}

func (MCPTool) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("upstream_id", uuid.UUID{}),
		field.String("name").NotEmpty().MaxLen(256),
		field.String("namespaced_name").NotEmpty().MaxLen(320),
		field.String("scope").NotEmpty().MaxLen(16).Default("platform"),
		field.UUID("user_id", uuid.UUID{}).Optional().Nillable(),
		field.Text("description").Optional(),
		field.JSON("input_schema", map[string]any{}).Optional(),
		field.Int64("price").Default(0),
		field.Bool("enabled").Default(true),
		field.String("version_hash").Optional().MaxLen(64),
		field.Time("synced_at").Optional().Nillable(),
		field.Time("deleted_at").Optional().Nillable(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (MCPTool) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("scope", "user_id", "namespaced_name").Unique(),
	}
}
