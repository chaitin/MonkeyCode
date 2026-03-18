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

// NotifyChannel holds the schema definition for a push notification channel.
type NotifyChannel struct {
	ent.Schema
}

func (NotifyChannel) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("notify_channels"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

func (NotifyChannel) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

func (NotifyChannel) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("owner_id", uuid.UUID{}),
		field.String("owner_type").GoType(consts.NotifyOwnerType("")).Default(string(consts.NotifyOwnerUser)),
		field.String("name").NotEmpty().MaxLen(64),
		field.String("kind").GoType(consts.NotifyChannelKind("")),
		field.Text("webhook_url").NotEmpty(),
		field.Text("secret").Optional().Default(""),
		field.JSON("headers", map[string]string{}).Optional(),
		field.Bool("enabled").Default(true),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (NotifyChannel) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("subscriptions", NotifySubscription.Type),
	}
}

func (NotifyChannel) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("owner_id", "owner_type"),
	}
}
