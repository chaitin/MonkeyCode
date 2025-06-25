package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

// BillingRecord holds the schema definition for the BillingRecord entity.
type BillingRecord struct {
	ent.Schema
}

func (BillingRecord) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{
			Table: "billing_records",
		},
	}
}

// Fields of the BillingRecord.
func (BillingRecord) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Unique(),
		field.String("tenant_id").Unique(),
		field.String("user_id").Unique(),
		field.String("model"),
		field.String("operation"),
		field.Int64("input_tokens"),
		field.Int64("output_tokens"),
		field.Int64("cost"),
		field.Time("request_time").Default(time.Now),
		field.JSON("metadata", map[string]any{}),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the BillingRecord.
func (BillingRecord) Edges() []ent.Edge {
	return nil
}
