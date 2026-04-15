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

type MCPUserToolSetting struct {
	ent.Schema
}

func (MCPUserToolSetting) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("mcp_user_tool_settings"),
	}
}

func (MCPUserToolSetting) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("user_id", uuid.UUID{}),
		field.UUID("tool_id", uuid.UUID{}),
		field.Bool("enabled").Default(true),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (MCPUserToolSetting) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id", "tool_id").Unique(),
	}
}
