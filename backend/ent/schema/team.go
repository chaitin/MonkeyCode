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

// Team holds the schema definition for the Team entity.
type Team struct {
	ent.Schema
}

func (Team) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("teams"),
	}
}

func (Team) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

// Fields of the Team.
func (Team) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.String("name").NotEmpty(),
		field.Int("member_limit"),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now),
	}
}

// Edges of the Team.
func (Team) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("groups", TeamGroup.Type),
		edge.From("members", User.Type).Ref("teams").Through("team_members", TeamMember.Type),
	}
}
