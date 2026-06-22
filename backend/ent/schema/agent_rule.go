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

// AgentRule holds the schema definition for the agent_rules entity.
type AgentRule struct {
	ent.Schema
}

func (AgentRule) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("agent_rules"),
	}
}

// Fields of the AgentRule.
func (AgentRule) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.String("name").NotEmpty(),
		field.Text("description").Optional(),
		field.Enum("scope_type").Values("global").Default("global"),
		field.String("scope_id").Default("global"),
		field.UUID("created_by", uuid.UUID{}),
		field.UUID("active_version_id", uuid.UUID{}).Optional().Nillable(),
		field.String("extension_package_id").Optional().Nillable(),
		field.String("extension_rule_id").Optional().Nillable(),
		field.String("extension_version").Optional().Nillable(),
		field.Bool("is_deleted").Default(false),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the AgentRule.
func (AgentRule) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("versions", AgentRuleVersion.Type),
	}
}

// Indexes of the AgentRule.
func (AgentRule) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("scope_type", "scope_id"),
		index.Fields("active_version_id"),
		index.Fields("extension_package_id", "extension_rule_id"),
	}
}

// AgentRuleVersion holds the schema definition for the agent_rule_versions entity.
type AgentRuleVersion struct {
	ent.Schema
}

func (AgentRuleVersion) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("agent_rule_versions"),
	}
}

// Fields of the AgentRuleVersion.
func (AgentRuleVersion) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.UUID("rule_id", uuid.UUID{}),
		field.String("version").MaxLen(14).NotEmpty(),
		field.Text("content"),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the AgentRuleVersion.
func (AgentRuleVersion) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("rule", AgentRule.Type).Ref("versions").Field("rule_id").Unique().Required(),
	}
}

// Indexes of the AgentRuleVersion.
func (AgentRuleVersion) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("rule_id"),
	}
}
