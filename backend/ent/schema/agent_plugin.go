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

	"github.com/chaitin/MonkeyCode/backend/ent/types"
)

// AgentPlugin holds the schema definition for the agent_plugins entity.
type AgentPlugin struct {
	ent.Schema
}

func (AgentPlugin) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("agent_plugins"),
	}
}

// Fields of the AgentPlugin.
func (AgentPlugin) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.UUID("repo_id", uuid.UUID{}),
		field.String("name").NotEmpty(),
		field.Text("description").Optional(),
		field.Enum("scope_type").Values("global").Default("global"),
		field.String("scope_id").Default("global"),
		field.UUID("created_by", uuid.UUID{}),
		field.UUID("active_version_id", uuid.UUID{}).Optional().Nillable(),
		field.Bool("is_force_delivery").Default(false),
		field.Bool("is_orphan").Default(false),
		field.Bool("is_deleted").Default(false),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the AgentPlugin.
func (AgentPlugin) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("repo", AgentPluginRepo.Type).Ref("plugins").Field("repo_id").Unique().Required(),
		edge.To("versions", AgentPluginVersion.Type),
	}
}

// Indexes of the AgentPlugin.
func (AgentPlugin) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("repo_id", "name").Unique(),
		index.Fields("scope_type", "scope_id"),
		index.Fields("active_version_id"),
	}
}

// AgentPluginVersion holds the schema definition for the agent_plugin_versions entity.
type AgentPluginVersion struct {
	ent.Schema
}

func (AgentPluginVersion) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("agent_plugin_versions"),
	}
}

// Fields of the AgentPluginVersion.
func (AgentPluginVersion) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.UUID("resource_id", uuid.UUID{}),
		field.String("version").NotEmpty(),
		field.String("s3_key").NotEmpty(),
		field.JSON("parsed_meta", types.PluginParsedMeta{}).Optional(),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the AgentPluginVersion.
func (AgentPluginVersion) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("plugin", AgentPlugin.Type).Ref("versions").Field("resource_id").Unique().Required(),
	}
}

// Indexes of the AgentPluginVersion.
func (AgentPluginVersion) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("resource_id"),
	}
}
