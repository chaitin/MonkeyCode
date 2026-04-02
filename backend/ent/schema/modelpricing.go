package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

// ModelPricing holds the schema definition for the ModelPricing entity.
type ModelPricing struct {
	ent.Schema
}

func (ModelPricing) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("model_pricings"),
	}
}

// Fields of the ModelPricing.
func (ModelPricing) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("model_id", uuid.UUID{}).Unique(),
		field.String("access_level").NotEmpty(),
		field.Bool("is_free").Default(true),
		field.Int64("input_price").Default(0),
		field.Int64("output_price").Default(0),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the ModelPricing.
func (ModelPricing) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("model", Model.Type).Ref("pricing").Field("model_id").Unique().Required(),
	}
}
