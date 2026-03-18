package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

// ProjectIssueComment holds the schema definition for the ProjectIssueComment entity.
type ProjectIssueComment struct {
	ent.Schema
}

func (ProjectIssueComment) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("project_issue_comments"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

func (ProjectIssueComment) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

// Fields of the ProjectIssueComment.
func (ProjectIssueComment) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("user_id", uuid.UUID{}),
		field.UUID("issue_id", uuid.UUID{}),
		field.UUID("parent_id", uuid.UUID{}).Optional(),
		field.Text("comment").NotEmpty(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the ProjectIssueComment.
func (ProjectIssueComment) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("project_issue_comments").Field("user_id").Unique().Required(),
		edge.From("issue", ProjectIssue.Type).Ref("comments").Field("issue_id").Unique().Required(),
		edge.From("parent", ProjectIssueComment.Type).Ref("replies").Field("parent_id").Unique(),
		edge.To("replies", ProjectIssueComment.Type),
	}
}
