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

// ProjectGitBot holds the schema definition for the ProjectGitBot entity.
type ProjectGitBot struct {
	ent.Schema
}

func (ProjectGitBot) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("project_git_bots"),
	}
}

func (ProjectGitBot) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.UUID("project_id", uuid.UUID{}),
		field.UUID("git_bot_id", uuid.UUID{}),
		field.Time("created_at").Default(time.Now),
	}
}

func (ProjectGitBot) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("project", Project.Type).Field("project_id").Required().Unique(),
		edge.To("git_bot", GitBot.Type).Field("git_bot_id").Required().Unique(),
	}
}
