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

// AgentPluginRepo holds the schema definition for the agent_plugin_repos entity.
type AgentPluginRepo struct {
	ent.Schema
}

func (AgentPluginRepo) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("agent_plugin_repos"),
	}
}

// Fields of the AgentPluginRepo.
func (AgentPluginRepo) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.String("name").NotEmpty(),
		field.Enum("scope_type").Values("global").Default("global"),
		field.String("scope_id").Default("global"),
		field.UUID("created_by", uuid.UUID{}),
		field.Enum("source_type").Values("github", "upload", "npm"),
		// github
		field.String("github_url").Optional().Nillable(),
		field.Enum("ref_type").Values("branch", "tag", "commit").Optional().Nillable(),
		field.String("ref_value").Optional().Nillable(),
		// upload
		field.String("last_upload_filename").Optional().Nillable(),
		field.Time("last_upload_at").Optional().Nillable(),
		// plugin discovery / manual entries
		field.Bool("plugin_discovery_auto_package_json").Default(true),
		field.JSON("plugin_manual_entries", types.PluginManualEntries{}).Optional(),
		// npm
		field.String("npm_package_name").Optional().Nillable(),
		field.String("npm_version_spec").Optional().Nillable(),
		field.String("npm_registry_url").Optional().Nillable(),

		field.Bool("is_deleted").Default(false),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the AgentPluginRepo.
func (AgentPluginRepo) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("plugins", AgentPlugin.Type),
	}
}

// Indexes of the AgentPluginRepo.
func (AgentPluginRepo) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("scope_type", "scope_id"),
	}
}
