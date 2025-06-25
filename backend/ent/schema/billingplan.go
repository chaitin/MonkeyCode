package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

// BillingPlan holds the schema definition for the BillingPlan entity.
type BillingPlan struct {
	ent.Schema
}

func (BillingPlan) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{
			Table: "billing_plans",
		},
	}
}

// Fields of the BillingPlan.
func (BillingPlan) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Unique(),
		field.String("name").Unique(),
		field.String("description"),
		field.JSON("rules", map[string]any{}),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the BillingPlan.
func (BillingPlan) Edges() []ent.Edge {
	return nil
}
