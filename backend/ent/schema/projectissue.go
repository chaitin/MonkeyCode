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

// ProjectIssue holds the schema definition for the ProjectIssue entity.
type ProjectIssue struct {
	ent.Schema
}

func (ProjectIssue) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("project_issues"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

func (ProjectIssue) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

// Fields of the ProjectIssue.
func (ProjectIssue) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("user_id", uuid.UUID{}),
		field.UUID("project_id", uuid.UUID{}),
		field.String("status").GoType(consts.ProjectIssueStatus("")).Default(string(consts.ProjectIssueStatusOpen)),
		field.Text("title").NotEmpty(),
		field.Text("requirement_document").Optional(),
		field.Text("design_document").Optional(),
		field.Text("summary").Optional(),
		field.UUID("assignee_id", uuid.UUID{}).Optional(),
		field.Int("priority").GoType(consts.ProjectIssuePriority(0)).Default(int(consts.ProjectIssuePriorityTwo)),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the ProjectIssue.
func (ProjectIssue) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("project_issues").Field("user_id").Unique().Required(),
		edge.From("assignee", User.Type).Ref("assigned_issues").Field("assignee_id").Unique(),
		edge.From("project", Project.Type).Ref("issues").Field("project_id").Unique().Required(),
		edge.To("comments", ProjectIssueComment.Type),
		edge.To("project_tasks", ProjectTask.Type),
	}
}
