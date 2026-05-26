package channel

import (
	"context"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type Message struct {
	Title string
	Body  string
}

type ChannelConfig struct {
	WebhookURL string
	Secret     string
	Headers    map[string]string
	// TargetID 用于 ID 类渠道（如 wechat_mp 存 openid）；URL 类渠道忽略。
	TargetID string
}

// Sender 通知渠道发送器。
//
// event 是事件原始数据，msg 是 renderer 已渲染好的 Title+Body（markdown）。
// 自由文本渠道（钉钉/飞书/企微/webhook）只用 msg，忽略 event；
// 结构化渠道（如微信公众号模板消息）需要直接从 event.Payload 抽字段
// 组装到固定 schema 的模板字段里，不能复用 markdown body。
//
// Validate 在 Send 之前由调用方调用，用于校验 ChannelConfig 的安全性（如 URL 类
// 渠道的 SSRF 防护、ID 类渠道的目标字段非空）。校验失败应返回错误，调用方据此
// 拦截 Send。这样把"哪些字段需要校验"的知识收敛在各 sender 自身，调用方不需要
// 根据 kind 做分支判断。
type Sender interface {
	Kind() consts.NotifyChannelKind
	Validate(cfg *ChannelConfig) error
	Send(ctx context.Context, cfg *ChannelConfig, event *domain.NotifyEvent, msg Message) error
}

type Registry struct {
	senders map[consts.NotifyChannelKind]Sender
}

func NewRegistry(senders ...Sender) *Registry {
	r := &Registry{senders: make(map[consts.NotifyChannelKind]Sender, len(senders))}
	for _, s := range senders {
		r.senders[s.Kind()] = s
	}
	return r
}

func (r *Registry) Get(kind consts.NotifyChannelKind) (Sender, bool) {
	s, ok := r.senders[kind]
	return s, ok
}
