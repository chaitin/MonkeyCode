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

// TeamImage holds the schema definition for the TeamImage entity.
type TeamImage struct {
	ent.Schema
}

func (TeamImage) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("team_images"),
	}
}

// Fields of the TeamImage.
func (TeamImage) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("team_id", uuid.UUID{}),
		field.UUID("image_id", uuid.UUID{}),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the TeamImage.
func (TeamImage) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("team", Team.Type).Field("team_id").Unique().Required(),
		edge.To("image", Image.Type).Field("image_id").Unique().Required(),
	}
}
