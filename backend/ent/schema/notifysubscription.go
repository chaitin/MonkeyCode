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

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

// NotifySubscription binds a channel to event types with a scope.
type NotifySubscription struct {
	ent.Schema
}

func (NotifySubscription) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("notify_subscriptions"),
	}
}

func (NotifySubscription) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

func (NotifySubscription) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("channel_id", uuid.UUID{}),
		field.String("scope").Default("self"),
		field.JSON("event_types", []consts.NotifyEventType{}),
		field.Bool("enabled").Default(true),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (NotifySubscription) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("channel", NotifyChannel.Type).Ref("subscriptions").Field("channel_id").Unique().Required(),
	}
}

func (NotifySubscription) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("channel_id"),
	}
}
