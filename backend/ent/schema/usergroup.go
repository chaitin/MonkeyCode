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

// UserGroup holds the schema definition for the UserGroup entity.
type UserGroup struct {
	ent.Schema
}

func (UserGroup) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{Table: "user_groups"},
	}
}

// Fields of the UserGroup.
func (UserGroup) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("admin_id", uuid.UUID{}),
		field.String("name").NotEmpty(),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the UserGroup.
func (UserGroup) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("owner", Admin.Type).Ref("myusergroups").Field("admin_id").Unique().Required(),
		edge.To("users", User.Type).Through("user_groups", UserGroupUser.Type),
		edge.To("admins", Admin.Type).Through("user_group_admins", UserGroupAdmin.Type),
	}
}
