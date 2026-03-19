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

// GitBotTask holds the schema definition for the GitBotTask entity.
type GitBotTask struct {
	ent.Schema
}

func (GitBotTask) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("git_bot_tasks"),
	}
}

func (GitBotTask) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.UUID("git_bot_id", uuid.UUID{}),
		field.UUID("task_id", uuid.UUID{}),
		field.Time("created_at").Default(time.Now),
	}
}

func (GitBotTask) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("task", Task.Type).Ref("git_bot_tasks").Field("task_id").Unique().Required(),
		edge.From("git_bot", GitBot.Type).Ref("git_bot_tasks").Field("git_bot_id").Unique().Required(),
	}
}
