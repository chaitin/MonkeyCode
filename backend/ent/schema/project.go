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

// Project holds the schema definition for the Project entity.
type Project struct {
	ent.Schema
}

func (Project) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("projects"),
		entx.NewCursor(entx.CursorKindUpdatedAt),
	}
}

func (Project) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

// Fields of the Project.
func (Project) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("user_id", uuid.UUID{}),
		field.String("name").NotEmpty(),
		field.Text("description").Optional(),
		field.String("platform").GoType(consts.GitPlatform("")).Optional(),
		field.String("repo_url").Optional(),
		field.String("branch").Optional(),
		field.UUID("git_identity_id", uuid.UUID{}).Optional(),
		field.UUID("image_id", uuid.UUID{}).Optional(),
		field.JSON("env_variables", map[string]any{}).Optional(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the Project.
func (Project) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("projects").Field("user_id").Unique().Required(),
		edge.From("git_identity", GitIdentity.Type).Ref("projects").Field("git_identity_id").Unique(),
		edge.From("image", Image.Type).Ref("projects").Field("image_id").Unique(),
		edge.To("issues", ProjectIssue.Type),
		edge.To("collaborators", ProjectCollaborator.Type),
		edge.To("project_tasks", ProjectTask.Type),
	}
}
