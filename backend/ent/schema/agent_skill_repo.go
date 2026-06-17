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

// AgentSkillRepo holds the schema definition for the agent_skill_repos entity.
type AgentSkillRepo struct {
	ent.Schema
}

func (AgentSkillRepo) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("agent_skill_repos"),
	}
}

// Fields of the AgentSkillRepo.
func (AgentSkillRepo) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.String("name").NotEmpty(),
		field.Enum("scope_type").Values("global", "team", "user").Default("global"),
		field.String("scope_id").Default("global"),
		field.UUID("created_by", uuid.UUID{}),
		field.Enum("source_type").Values("github", "upload", "bare"),
		// github
		field.String("github_url").Optional().Nillable(),
		field.Enum("ref_type").Values("branch", "tag", "commit").Optional().Nillable(),
		field.String("ref_value").Optional().Nillable(),
		// upload
		field.String("last_upload_filename").Optional().Nillable(),
		field.Time("last_upload_at").Optional().Nillable(),

		field.Bool("is_deleted").Default(false),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the AgentSkillRepo.
func (AgentSkillRepo) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("skills", AgentSkill.Type),
	}
}

// Indexes of the AgentSkillRepo.
func (AgentSkillRepo) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("scope_type", "scope_id"),
	}
}
