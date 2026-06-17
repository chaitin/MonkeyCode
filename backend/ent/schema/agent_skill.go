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
		field.Enum("scope_type").Values("global", "team", "user").Default("global"),
		field.String("scope_id").Default("global"),
		field.UUID("created_by", uuid.UUID{}),
		field.UUID("active_version_id", uuid.UUID{}).Optional().Nillable(),
		field.Bool("is_force_delivery").Default(false),
		field.Bool("is_orphan").Default(false),
		field.Bool("is_deleted").Default(false),
		// enabled 由平台管理员(mcai-admin-new 直写 DB)控制。
		// 默认 true;false 时 listing 仍展示 + dispatch 跳过。
		field.Bool("enabled").Default(true),
		// admin_description / admin_tags:系统管理员在 mcai-admin-new 手动设置
		// 的覆写值。非 nil 时 /api/v1/skills 优先返回这些而非 parsed_meta 里
		// 从 frontmatter 解析出来的值。sync worker 不碰这两个字段。
		field.String("extension_package_id").Optional().Nillable(),
		field.Text("admin_description").Optional().Nillable(),
		field.JSON("admin_tags", []string{}).Optional(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the AgentSkill.
func (AgentSkill) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("repo", AgentSkillRepo.Type).Ref("skills").Field("repo_id").Unique().Required(),
		edge.To("versions", AgentSkillVersion.Type),
		// team scope 下分组共享的关联走 agent_skill_group_bindings 表,
		// repo 层显式 join 查,不在 ent edge 上暴露 Through(避免 M2M
		// 复杂约束;参考 team_group_models 同款做法)。
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
