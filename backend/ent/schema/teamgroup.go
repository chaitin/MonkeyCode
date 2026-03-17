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

// TeamGroup holds the schema definition for the TeamGroup entity.
type TeamGroup struct {
	ent.Schema
}

func (TeamGroup) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("team_groups"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

func (TeamGroup) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

// Fields of the TeamGroup.
func (TeamGroup) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("team_id", uuid.UUID{}),
		field.String("name"),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the TeamGroup.
func (TeamGroup) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("members", User.Type).Ref("groups").Through("team_group_members", TeamGroupMember.Type),
		edge.From("team", Team.Type).Ref("groups").Field("team_id").Unique().Required(),
		edge.To("models", Model.Type).Through("team_group_models", TeamGroupModel.Type),
		edge.To("images", Image.Type).Through("team_group_images", TeamGroupImage.Type),
		edge.To("hosts", Host.Type).Through("team_group_hosts", TeamGroupHost.Type),
	}
}
