package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

// AdminRole holds the schema definition for the AdminRole entity.
type AdminRole struct {
	ent.Schema
}

func (AdminRole) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "admin_roles"},
	}
}

// Fields of the AdminRole.
func (AdminRole) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("admin_id", uuid.UUID{}),
		field.Int64("role_id"),
	}
}

// Edges of the AdminRole.
func (AdminRole) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("admin", Admin.Type).Field("admin_id").Unique().Required(),
		edge.To("role", Role.Type).Field("role_id").Unique().Required(),
	}
}
