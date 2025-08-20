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

// UserGroupUser holds the schema definition for the UserGroupUser entity.
type UserGroupUser struct {
	ent.Schema
}

// Annotations of the UserGroupUser.
func (UserGroupUser) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "user_group_users"},
	}
}

// Fields of the UserGroupUser.
func (UserGroupUser) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("user_group_id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}),
	}
}

func (UserGroupUser) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_group_id", "user_id").Unique(),
	}
}

// Edges of the UserGroupUser.
func (UserGroupUser) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("user_group", UserGroup.Type).Field("user_group_id").Unique().Required(),
		edge.To("user", User.Type).Field("user_id").Unique().Required(),
	}
}
