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

// GitIdentity holds the schema definition for the GitIdentity entity.
type GitIdentity struct {
	ent.Schema
}

func (GitIdentity) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("git_identities"),
	}
}

func (GitIdentity) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

// Fields of the GitIdentity.
func (GitIdentity) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("user_id", uuid.UUID{}),
		field.String("platform").GoType(consts.GitPlatform("")),
		field.String("base_url").Optional(),
		field.String("access_token").Optional(),
		field.String("username").Optional(),
		field.String("email").Optional(),
		field.Int64("installation_id").Optional(),
		field.String("remark").Optional(),
		field.String("oauth_refresh_token").Optional(),
		field.Time("oauth_expires_at").Optional().Nillable(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the GitIdentity.
func (GitIdentity) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("git_identities").Field("user_id").Unique().Required(),
		edge.To("projects", Project.Type),
		edge.To("project_tasks", ProjectTask.Type),
	}
}
