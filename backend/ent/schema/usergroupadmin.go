package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"
)

// UserGroupAdmin holds the schema definition for the UserGroupAdmin entity.
type UserGroupAdmin struct {
	ent.Schema
}

// Annotations of the UserGroupAdmin.
func (UserGroupAdmin) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "user_group_admins"},
	}
}

// Fields of the UserGroupAdmin.
func (UserGroupAdmin) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("user_group_id", uuid.UUID{}),
		field.UUID("admin_id", uuid.UUID{}),
	}
}

// Indexes of the UserGroupAdmin.
func (UserGroupAdmin) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_group_id", "admin_id").Unique(),
	}
}

// Edges of the UserGroupAdmin.
func (UserGroupAdmin) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("user_group", UserGroup.Type).Field("user_group_id").Unique().Required(),
		edge.To("admin", Admin.Type).Field("admin_id").Unique().Required(),
	}
}
