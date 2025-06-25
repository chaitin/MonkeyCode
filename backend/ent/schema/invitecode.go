package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

// InviteCode holds the schema definition for the InviteCode entity.
type InviteCode struct {
	ent.Schema
}

func (InviteCode) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{
			Table: "invite_codes",
		},
	}
}

// Fields of the InviteCode.
func (InviteCode) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("admin_id", uuid.UUID{}),
		field.String("code").Unique(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the InviteCode.
func (InviteCode) Edges() []ent.Edge {
	return nil
}
