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

// TeamGroupImage holds the schema definition for the TeamGroupImage entity.
type TeamGroupImage struct {
	ent.Schema
}

func (TeamGroupImage) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("team_group_images"),
	}
}

// Fields of the TeamGroupImage.
func (TeamGroupImage) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("group_id", uuid.UUID{}),
		field.UUID("image_id", uuid.UUID{}),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the TeamGroupImage.
func (TeamGroupImage) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("group", TeamGroup.Type).Field("group_id").Unique().Required(),
		edge.To("image", Image.Type).Field("image_id").Unique().Required(),
	}
}
