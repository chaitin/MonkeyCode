package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"

	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

// BillingUsage holds the schema definition for the BillingUsage entity.
type BillingUsage struct {
	ent.Schema
}

func (BillingUsage) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{
			Table: "billing_usages",
		},
	}
}

func (BillingUsage) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin{},
	}
}

// Fields of the BillingUsage.
func (BillingUsage) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Unique(),
		field.String("user_id").Unique(),
		field.String("model_name"),
		field.Int64("tokens"),
		field.String("operation"),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the BillingUsage.
func (BillingUsage) Edges() []ent.Edge {
	return nil
}
