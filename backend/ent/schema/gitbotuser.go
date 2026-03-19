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

// GitBotUser holds the schema definition for the GitBotUser entity.
type GitBotUser struct {
	ent.Schema
}

func (GitBotUser) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("git_bot_users"),
	}
}

func (GitBotUser) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.UUID("git_bot_id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}),
		field.Time("created_at").Default(time.Now),
	}
}

func (GitBotUser) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("git_bot", GitBot.Type).Field("git_bot_id").Unique().Required(),
		edge.To("user", User.Type).Field("user_id").Unique().Required(),
	}
}
