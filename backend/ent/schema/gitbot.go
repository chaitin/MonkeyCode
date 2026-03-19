package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

// GitBot holds the schema definition for the GitBot entity.
type GitBot struct {
	ent.Schema
}

func (GitBot) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("git_bots"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

func (GitBot) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

func (GitBot) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}),
		field.String("name").Optional(),
		field.String("host_id"),
		field.String("token").Optional(),
		field.String("secret_token").Optional(),
		field.String("platform").GoType(consts.GitPlatform("")),
		field.Time("created_at").Default(time.Now),
	}
}

func (GitBot) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("git_bot_tasks", GitBotTask.Type),
		edge.From("host", Host.Type).Ref("git_bots").Field("host_id").Unique().Required(),
		edge.From("users", User.Type).Through("git_bot_users", GitBotUser.Type).Ref("git_bots"),
		edge.From("projects", Project.Type).Through("project_git_bots", ProjectGitBot.Type).Ref("git_bots"),
	}
}
