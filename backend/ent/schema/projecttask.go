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
)

// ProjectTask holds the schema definition for the ProjectTask entity.
type ProjectTask struct {
	ent.Schema
}

func (ProjectTask) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("project_tasks"),
	}
}

// Fields of the ProjectTask.
func (ProjectTask) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("task_id", uuid.UUID{}),
		field.UUID("model_id", uuid.UUID{}),
		field.UUID("image_id", uuid.UUID{}),
		field.UUID("git_identity_id", uuid.UUID{}).Optional(),
		field.UUID("project_id", uuid.UUID{}).Optional().Nillable(),
		field.UUID("issue_id", uuid.UUID{}).Optional(),
		field.String("repo_url").Optional(),
		field.String("repo_filename").Optional(),
		field.String("branch").Optional(),
		field.String("cli_name").GoType(consts.CliName("")),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the ProjectTask.
func (ProjectTask) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("task", Task.Type).Field("task_id").Ref("project_tasks").Unique().Required(),
		edge.From("model", Model.Type).Field("model_id").Ref("project_tasks").Unique().Required(),
		edge.From("image", Image.Type).Field("image_id").Ref("project_tasks").Unique().Required(),
		edge.From("git_identity", GitIdentity.Type).Field("git_identity_id").Ref("project_tasks").Unique(),
		edge.From("project", Project.Type).Field("project_id").Ref("project_tasks").Unique(),
		edge.From("issue", ProjectIssue.Type).Field("issue_id").Ref("project_tasks").Unique(),
	}
}
