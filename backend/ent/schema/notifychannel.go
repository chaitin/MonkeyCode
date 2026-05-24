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
		// webhook_url 仅用于 URL 类渠道（dingtalk/feishu/wecom/webhook）；ID 类渠道（wechat_mp）走 target_id，此字段存空串
		field.Text("webhook_url"),
		field.Text("secret").Optional().Default(""),
		field.JSON("headers", map[string]string{}).Optional(),
		field.JSON("metadata", map[string]string{}).Optional(),
		// target_id 用于 ID 类渠道（如 wechat_mp 存 openid、未来飞书私聊/Telegram bot 等）
		field.String("target_id").Default(""),
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
		// 微信公众号每个用户最多一条 active 渠道，业务层先查后写有 race，靠 partial unique 兜底。
		// 对应 migration 000009 的 idx_notify_channels_wechat_mp_owner。
		index.Fields("owner_id").
			Unique().
			Annotations(entsql.IndexWhere("kind = 'wechat_mp' AND deleted_at IS NULL")),
		// HandleUnsubscribe 按 openid 反查所有绑定该 openid 的渠道；带 kind 前缀确保只扫 wechat_mp 行。
		index.Fields("kind", "target_id").
			Annotations(entsql.IndexWhere("deleted_at IS NULL")),
	}
}
