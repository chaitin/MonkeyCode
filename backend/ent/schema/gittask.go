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

type GitTask struct {
	ent.Schema
}

func (GitTask) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("git_tasks"),
	}
}

// Fields of the GitTask.
func (GitTask) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("task_id", uuid.UUID{}),
		field.UUID("repo_id", uuid.UUID{}).Optional(),
		field.String("subject_type").NotEmpty(),
		field.String("subject_id").Optional(),
		field.Int("subject_number").Optional(),
		field.String("subject_url").Optional(),
		field.String("subject_title").Optional(),
		field.String("prompt_id").Optional(),
		field.Text("show_url").Optional(),
		field.Int64("github_installation_id").Optional(),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the GitTask.
func (GitTask) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("task", Task.Type).Ref("git_tasks").Field("task_id").Unique().Required(),
	}
}
