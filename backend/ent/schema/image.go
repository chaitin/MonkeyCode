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

// Image holds the schema definition for the Image entity.
type Image struct {
	ent.Schema
}

func (Image) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("images"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

func (Image) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

// Fields of the Image.
func (Image) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("user_id", uuid.UUID{}),
		field.String("name").NotEmpty(),
		field.String("remark").Optional(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the Image.
func (Image) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("images").Field("user_id").Unique().Required(),
		edge.From("teams", Team.Type).Ref("images").Through("team_images", TeamImage.Type),
		edge.From("groups", TeamGroup.Type).Ref("images").Through("team_group_images", TeamGroupImage.Type),
		edge.To("project_tasks", ProjectTask.Type),
		edge.To("projects", Project.Type),
	}
}
