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

// ProjectCollaborator holds the schema definition for the ProjectCollaborator entity.
type ProjectCollaborator struct {
	ent.Schema
}

func (ProjectCollaborator) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("project_collaborators"),
	}
}

func (ProjectCollaborator) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

// Fields of the ProjectCollaborator.
func (ProjectCollaborator) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("project_id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}),
		field.String("role").GoType(consts.ProjectCollaboratorRole("")).Default(string(consts.ProjectCollaboratorRoleReadOnly)),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the ProjectCollaborator.
func (ProjectCollaborator) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("project_collaborators").Field("user_id").Unique().Required(),
		edge.From("project", Project.Type).Ref("collaborators").Field("project_id").Unique().Required(),
	}
}
