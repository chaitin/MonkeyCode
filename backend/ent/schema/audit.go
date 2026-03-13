package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/google/uuid"
)

// Audit holds the schema definition for the Audit entity.
type Audit struct {
	ent.Schema
}

func (Audit) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("audits"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

// Fields of the Audit.
func (Audit) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}),
		field.String("operation"),
		field.String("source_ip"),
		field.String("user_agent"),
		field.String("request"),
		field.String("response").Optional(),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the Audit.
func (Audit) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("audits").Field("user_id").Unique().Required(),
	}
}
