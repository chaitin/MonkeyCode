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
)

type MCPToolCall struct {
	ent.Schema
}

func (MCPToolCall) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("mcp_tool_calls"),
	}
}

func (MCPToolCall) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.String("request_id").NotEmpty().MaxLen(128).Unique(),
		field.UUID("task_id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}),
		field.UUID("upstream_id", uuid.UUID{}),
		field.UUID("tool_id", uuid.UUID{}),
		field.String("tool_name_snapshot").NotEmpty().MaxLen(320),
		field.Enum("tool_scope_snapshot").Values("platform", "user", "team").Default("platform"),
		field.Int64("price_snapshot").Default(0),
		field.Enum("status").Values("pending", "success", "failed", "unknown", "refunded").Default("pending"),
		field.JSON("args_json", map[string]any{}).Optional(),
		field.JSON("result_json", map[string]any{}).Optional(),
		field.Text("error_message").Default(""),
		field.String("upstream_request_id").Optional().MaxLen(128),
		field.Time("started_at"),
		field.Time("finished_at").Optional().Nillable(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (MCPToolCall) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("task_id"),
		index.Fields("user_id"),
		index.Fields("upstream_id"),
		index.Fields("tool_id"),
		index.Fields("status"),
	}
}

func (MCPToolCall) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("upstream", MCPUpstream.Type).Field("upstream_id").Unique().Required(),
		edge.To("tool", MCPTool.Type).Field("tool_id").Unique().Required(),
	}
}
