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

// UserLoginHistory holds the schema definition for the UserLoginHistory entity.
type UserLoginHistory struct {
	ent.Schema
}

func (UserLoginHistory) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{
			Table: "user_login_histories",
		},
	}
}

// Fields of the UserLoginHistory.
func (UserLoginHistory) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}),
		field.String("ip"),
		field.String("country"),
		field.String("province"),
		field.String("city"),
		field.String("isp"),
		field.String("asn"),
		field.String("client_version"),
		field.String("device"),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the UserLoginHistory.
func (UserLoginHistory) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("owner", User.Type).Ref("login_histories").Unique(),
	}
}
