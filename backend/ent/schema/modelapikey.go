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

// ModelApiKey holds the schema definition for the ModelApiKey entity.
type ModelApiKey struct {
	ent.Schema
}

func (ModelApiKey) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("model_api_keys"),
	}
}

func (ModelApiKey) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

// Fields of the ModelApiKey.
func (ModelApiKey) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("model_id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}),
		field.String("virtualmachine_id").Optional(),
		field.Text("api_key").NotEmpty(),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the ModelApiKey.
func (ModelApiKey) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("model", Model.Type).Ref("apikeys").Field("model_id").Unique().Required(),
	}
}
