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

// UserIdentity holds the schema definition for the UserIdentity entity.
type UserIdentity struct {
	ent.Schema
}

func (UserIdentity) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("user_identities"),
	}
}

func (UserIdentity) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

// Fields of the UserIdentity.
func (UserIdentity) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("user_id", uuid.UUID{}),
		field.String("platform").GoType(consts.UserPlatform("")).NotEmpty(),
		field.String("identity_id").NotEmpty(),
		field.String("username").NotEmpty(),
		field.String("email").Optional(),
		field.String("avatar_url").Optional(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").UpdateDefault(time.Now).Optional(),
	}
}

// Edges of the UserIdentity.
func (UserIdentity) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("identities").Field("user_id").Required().Unique(),
	}
}
