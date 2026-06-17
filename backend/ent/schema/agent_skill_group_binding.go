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

// AgentSkillGroupBinding 把 team scope 下的 agent_skill 关联到 team_group,
// 用于"按分组共享 skill"语义。仅对 scope_type='team' 的 skill 有意义;
// global/user scope 的 skill 不应出现在这张表里。
type AgentSkillGroupBinding struct {
	ent.Schema
}

func (AgentSkillGroupBinding) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("agent_skill_group_bindings"),
	}
}

func (AgentSkillGroupBinding) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.UUID("skill_id", uuid.UUID{}),
		field.UUID("group_id", uuid.UUID{}),
		field.Time("created_at").Default(time.Now),
	}
}

func (AgentSkillGroupBinding) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("skill", AgentSkill.Type).Field("skill_id").Unique().Required(),
		edge.To("group", TeamGroup.Type).Field("group_id").Unique().Required(),
	}
}

func (AgentSkillGroupBinding) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("skill_id", "group_id").Unique(),
		index.Fields("group_id"),
	}
}
