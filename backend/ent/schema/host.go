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

// Host holds the schema definition for the Host entity.
type Host struct {
	ent.Schema
}

func (Host) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("hosts"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

func (Host) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

// Fields of the Host.
func (Host) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Unique(),
		field.UUID("user_id", uuid.UUID{}),
		field.String("hostname").Optional(),
		field.String("arch").Optional(),
		field.Int("cores").Optional(),
		field.Int("weight").Default(1),
		field.Int64("memory").Optional(),
		field.Int64("disk").Optional(),
		field.String("os").Optional(),
		field.String("external_ip").Optional(),
		field.String("internal_ip").Optional(),
		field.String("version").Optional(),
		field.String("machine_id").Optional(),
		field.String("remark").Optional(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the Host.
func (Host) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("vms", VirtualMachine.Type),
		edge.From("user", User.Type).Field("user_id").Ref("hosts").Unique().Required(),
		edge.From("groups", TeamGroup.Type).Ref("hosts").Through("team_group_hosts", TeamGroupHost.Type),
	}
}
