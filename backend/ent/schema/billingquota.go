package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"

	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

// BillingQuota holds the schema definition for the BillingQuota entity.
type BillingQuota struct {
	ent.Schema
}

func (BillingQuota) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{
			Table: "billing_quotas",
		},
	}
}

func (BillingQuota) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin{},
	}
}

// Fields of the BillingQuota.
func (BillingQuota) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Unique(),
		field.String("user_id").Unique(),
		field.Int64("total"),
		field.Int64("used"),
		field.Int64("remain"),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the BillingQuota.
func (BillingQuota) Edges() []ent.Edge {
	return nil
}
