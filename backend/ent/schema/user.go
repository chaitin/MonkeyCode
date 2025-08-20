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

// User holds the schema definition for the User entity.
type User struct {
	ent.Schema
}

func (User) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{
			Table: "users",
		},
	}
}

func (User) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin{},
	}
}

// Fields of the User.
func (User) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.String("username").Optional(),
		field.String("password").Optional(),
		field.String("email").Optional(),
		field.String("avatar_url").Optional(),
		field.String("platform").GoType(consts.UserPlatform("")).Default(string(consts.UserPlatformEmail)),
		field.String("status").GoType(consts.UserStatus("")).Default(string(consts.UserStatusActive)),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now),
	}
}

// Edges of the User.
func (User) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("login_histories", UserLoginHistory.Type),
		edge.To("models", Model.Type),
		edge.To("tasks", Task.Type),
		edge.To("identities", UserIdentity.Type),
		edge.To("workspaces", Workspace.Type),
		edge.To("workspace_files", WorkspaceFile.Type),
		edge.To("api_keys", ApiKey.Type),
		edge.To("security_scannings", SecurityScanning.Type),
		edge.From("groups", UserGroup.Type).Ref("users").Through("user_groups", UserGroupUser.Type),
	}
}
