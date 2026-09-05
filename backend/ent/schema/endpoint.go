package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"
)

type Endpoint struct {
	ent.Schema
}

func (Endpoint) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Table("endpoints")}
}

func (Endpoint) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.UUID("user_id", uuid.UUID{}),
		field.UUID("machine_id", uuid.UUID{}),
		field.String("device_name").NotEmpty(),
		field.Enum("platform").Values("macos", "windows", "linux", "ios", "android"),
		field.String("os_version"),
		field.String("arch"),
		field.String("client_version"),
		field.Int("protocol_version").Default(1),
		field.String("alias").Optional().Nillable(),
		field.Enum("status").Values("active", "revoked").Default("active"),
		field.Time("last_seen_at").Optional().Nillable(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (Endpoint) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Field("user_id").Ref("endpoints").Unique().Required(),
	}
}

func (Endpoint) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("user_id", "machine_id").Unique(),
	}
}
