package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type Skill struct {
	ent.Schema
}

func (Skill) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("skills"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

func (Skill) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

func (Skill) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("user_id", uuid.UUID{}),
		field.String("name").NotEmpty(),
		field.Text("description").NotEmpty(),
		field.JSON("tags", []string{}).Optional(),
		field.Text("content").NotEmpty(),
		field.String("package_object_key").Optional(),
		field.String("package_url").Optional(),
		field.String("source_type").NotEmpty(),
		field.String("source_label").NotEmpty(),
		field.String("skill_md_path").Optional(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (Skill) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("skills").Field("user_id").Unique().Required(),
		edge.From("teams", Team.Type).Ref("skills").Through("team_skills", TeamSkill.Type),
		edge.From("groups", TeamGroup.Type).Ref("skills").Through("team_group_skills", TeamGroupSkill.Type),
	}
}
