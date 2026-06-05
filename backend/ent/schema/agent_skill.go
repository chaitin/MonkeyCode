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

// AgentSkill holds the schema definition for the agent_skills entity.
type AgentSkill struct {
	ent.Schema
}

func (AgentSkill) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("agent_skills"),
	}
}

// Fields of the AgentSkill.
func (AgentSkill) Fields() []ent.Field {
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

// Edges of the AgentSkill.
func (AgentSkill) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("repo", AgentSkillRepo.Type).Ref("skills").Field("repo_id").Unique().Required(),
		edge.To("versions", AgentSkillVersion.Type),
	}
}

// Indexes of the AgentSkill.
func (AgentSkill) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("repo_id", "name").Unique(),
		index.Fields("scope_type", "scope_id"),
		index.Fields("active_version_id"),
	}
}

// AgentSkillVersion holds the schema definition for the agent_skill_versions entity.
type AgentSkillVersion struct {
	ent.Schema
}

func (AgentSkillVersion) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("agent_skill_versions"),
	}
}

// Fields of the AgentSkillVersion.
func (AgentSkillVersion) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.UUID("resource_id", uuid.UUID{}),
		field.String("version").NotEmpty(),
		field.String("s3_key").NotEmpty(),
		field.JSON("parsed_meta", types.SkillParsedMeta{}).Optional(),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the AgentSkillVersion.
func (AgentSkillVersion) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("skill", AgentSkill.Type).Ref("versions").Field("resource_id").Unique().Required(),
	}
}

// Indexes of the AgentSkillVersion.
func (AgentSkillVersion) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("resource_id"),
	}
}
