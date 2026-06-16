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

type TeamExtensionImageArchive struct {
	ent.Schema
}

func (TeamExtensionImageArchive) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("team_extension_image_archives"),
	}
}

func (TeamExtensionImageArchive) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("team_id", uuid.UUID{}),
		field.UUID("image_id", uuid.UUID{}),
		field.String("package_id").NotEmpty(),
		field.String("extension_image_id").NotEmpty(),
		field.String("version").NotEmpty(),
		field.String("arch").NotEmpty(),
		field.String("image_name").NotEmpty(),
		field.String("archive_path").NotEmpty(),
		field.String("archive_url").NotEmpty(),
		field.String("sha256").Optional(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (TeamExtensionImageArchive) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("team", Team.Type).Ref("extension_image_archives").Field("team_id").Unique().Required(),
		edge.From("image", Image.Type).Ref("extension_archives").Field("image_id").Unique().Required(),
	}
}
