package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

// NotifySendLog records each notification send attempt for auditing and dedup.
type NotifySendLog struct {
	ent.Schema
}

func (NotifySendLog) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("notify_send_logs"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

func (NotifySendLog) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("subscription_id", uuid.UUID{}),
		field.UUID("channel_id", uuid.UUID{}),
		field.String("event_type").GoType(consts.NotifyEventType("")),
		field.String("event_ref_id"),
		field.String("status").GoType(consts.NotifySendStatus("")),
		field.Text("error").Optional().Default(""),
		field.Time("created_at").Default(time.Now),
	}
}

func (NotifySendLog) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("subscription_id", "event_type", "event_ref_id"),
		index.Fields("status", "created_at"),
	}
}
