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
	"github.com/chaitin/MonkeyCode/backend/ent/types"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

// VirtualMachine holds the schema definition for the VirtualMachine entity.
type VirtualMachine struct {
	ent.Schema
}

func (VirtualMachine) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("virtualmachines"),
	}
}

func (VirtualMachine) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

// Fields of the VirtualMachine.
func (VirtualMachine) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").Unique(),
		field.String("host_id"),
		field.UUID("user_id", uuid.UUID{}).Optional(),
		field.UUID("model_id", uuid.UUID{}).Optional(),
		field.String("environment_id").Optional(),
		field.String("name"),
		field.String("hostname").Optional(),
		field.String("arch").Optional(),
		field.Int("cores").Optional(),
		field.Int64("memory").Optional(),
		field.String("os").Optional(),
		field.String("external_ip").Optional(),
		field.String("internal_ip").Optional(),
		field.String("ttl_kind").GoType(consts.VirtualmachineTTLKind("")).Optional(),
		field.Int64("ttl").Optional(),
		field.String("version").Optional(),
		field.String("machine_id").Optional(),
		field.String("repo_url").Optional(),
		field.String("repo_filename").Optional(),
		field.String("branch").Optional(),
		field.Bool("is_recycled").Optional(),
		field.JSON("conditions", &types.VirtualMachineCondition{}).Optional(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now),
	}
}

// Edges of the VirtualMachine.
func (VirtualMachine) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("host", Host.Type).Ref("vms").Field("host_id").Unique().Required(),
		edge.From("model", Model.Type).Ref("vms").Field("model_id").Unique(),
		edge.From("user", User.Type).Ref("vms").Field("user_id").Unique(),
		edge.To("tasks", Task.Type).Through("task_vms", TaskVirtualMachine.Type),
	}
}
