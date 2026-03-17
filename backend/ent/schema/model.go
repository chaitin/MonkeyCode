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

// Model holds the schema definition for the Model entity.
type Model struct {
	ent.Schema
}

func (Model) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("models"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

func (Model) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

// Fields of the Model.
func (Model) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("user_id", uuid.UUID{}),
		field.String("provider").NotEmpty(),
		field.Text("api_key").NotEmpty(),
		field.Text("base_url").NotEmpty(),
		field.String("model").NotEmpty(),
		field.String("remark").Optional(),
		field.Float("temperature").Optional(),
		field.String("interface_type").Optional(),
		field.Int("weight").Default(1),
		field.Time("last_check_at").Optional(),
		field.Bool("last_check_success").Optional(),
		field.String("last_check_error").Optional(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the Model.
func (Model) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("models").Field("user_id").Unique().Required(),
		edge.From("teams", Team.Type).Ref("models").Through("team_models", TeamModel.Type),
		edge.From("groups", TeamGroup.Type).Ref("models").Through("team_group_models", TeamGroupModel.Type),
		edge.To("vms", VirtualMachine.Type),
	}
}
