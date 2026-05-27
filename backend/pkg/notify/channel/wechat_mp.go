package channel

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/msgpush"
)

// WechatMPSender 微信公众号模板消息推送。
//
// 微信公众号模板消息是强 schema 的结构化推送（thing 字段 ≤20 字符，
// 不支持 markdown），与钉钉/飞书那种自由 markdown 渠道完全不同，
// 所以这里不复用 renderer 输出的 msg.Body，而是直接从 event.Payload
// 抽字段、按字段类型 truncate、组装到模板字段中。
//
// 模板 ID 全部走 cfg.Wechat.MP.Templates[event_type] 路由，每个事件类型
// 对应一个公众号模板（可以指向同一模板 ID，也可以分开）。字段结构按事件类型分两套：
//
//  1. vm.expiring_soon —— thing16/thing3/time2/thing25/time35
//  2. quota.* (4 个) —— thing17/thing8/const4/time10
//
// URL 字段：vm 类填 TaskURL；quota 类填 quotaJumpURL（首页）。
type WechatMPSender struct {
	cfg          *config.Config
	wechatClient *msgpush.WechatClient
}

const quotaJumpURL = "https://monkeycode-ai.com"

func NewWechatMPSender(cfg *config.Config, wechatClient *msgpush.WechatClient) *WechatMPSender {
	return &WechatMPSender{cfg: cfg, wechatClient: wechatClient}
}

func (s *WechatMPSender) Kind() consts.NotifyChannelKind {
	return consts.NotifyChannelWechatMP
}

// Validate 仅校验 ID 类必需字段；URL/Header 不适用此渠道。
func (s *WechatMPSender) Validate(cfg *ChannelConfig) error {
	if cfg.TargetID == "" {
		return fmt.Errorf("wechat_mp: missing openid (target_id)")
	}
	return nil
}

func (s *WechatMPSender) Send(ctx context.Context, cfg *ChannelConfig, event *domain.NotifyEvent, msg Message) error {
	openID := cfg.TargetID
	if openID == "" {
		return fmt.Errorf("wechat_mp: missing openid (target_id)")
	}

	templateID, data, url := s.buildTemplate(event, msg)
	if templateID == "" {
		return fmt.Errorf("wechat_mp: no template configured for event %s", event.EventType)
	}

	eventType := ""
	refID := ""
	userID := ""
	if event != nil {
		eventType = string(event.EventType)
		refID = event.RefID
		userID = event.SubjectUserID.String()
	}
	logger := slog.With("module", "wechat_mp.sender", "user_id", userID, "openid", openID)
	logger.InfoContext(ctx, "wechat mp sender: sending template message",
		"template_id", templateID,
		"event_type", eventType,
		"ref_id", refID,
		"data", data,
		"url", url,
	)

	err := s.wechatClient.SendTemplateMessage(ctx, &msgpush.TemplateMessage{
		ToUser:     openID,
		TemplateID: templateID,
		URL:        url,
		Data:       data,
	})
	if err != nil {
		logger.ErrorContext(ctx, "wechat mp sender: send failed",
			"event_type", eventType,
			"ref_id", refID,
			"error", err,
		)
	}
	return err
}

// buildTemplate 根据事件类型选择模板 ID + 构造字段 + URL。
func (s *WechatMPSender) buildTemplate(event *domain.NotifyEvent, msg Message) (templateID string, data map[string]msgpush.TemplateMessageData, url string) {
	if event != nil {
		templateID = s.cfg.Wechat.MP.Templates[string(event.EventType)]
	}

	if event != nil && event.EventType == consts.NotifyEventQuotaRefreshed {
		data = s.buildQuotaRefreshedFields(event)
		url = quotaJumpURL
		return
	}

	if event != nil && isQuotaExhaustedEvent(event.EventType) {
		data = s.buildQuotaFields(event)
		url = quotaJumpURL
		return
	}

	thing16, thing3, time2, thing25, time35 := s.buildFields(event, msg)
	data = map[string]msgpush.TemplateMessageData{
		"thing16": {Value: thing16},
		"thing3":  {Value: thing3},
		"time2":   {Value: time2},
		"thing25": {Value: thing25},
		"time35":  {Value: time35},
	}
	if event != nil {
		url = event.Payload.TaskURL
	}
	return
}

func isQuotaExhaustedEvent(t consts.NotifyEventType) bool {
	switch t {
	case consts.NotifyEventQuotaBasicExhausted,
		consts.NotifyEventQuotaProExhausted,
		consts.NotifyEventQuotaUltraExhausted:
		return true
	}
	return false
}

// buildQuotaRefreshedFields 构造会员免费额度刷新模板字段。
func (s *WechatMPSender) buildQuotaRefreshedFields(event *domain.NotifyEvent) map[string]msgpush.TemplateMessageData {
	const thingMax = 20
	userName := "-"
	if event.Payload.UserName != "" {
		userName = truncateRune(event.Payload.UserName, thingMax)
	}
	return map[string]msgpush.TemplateMessageData{
		"thing20": {Value: userName},
		"thing9":  {Value: "MonkeyCode"},
		"thing12": {Value: "会员免费额度已刷新"},
		"time7":   {Value: time.Now().Format("2006-01-02 15:04:05")},
	}
}

// buildQuotaFields 构造 quota 类模板的 4 个字段：
//
//	thing17.DATA 平台名称 → "MonkeyCode"
//	thing8.DATA  账户名称 → event.Payload.UserName（rune 截到 20）
//	const4.DATA  异常原因 → 按 EventType 4 选 1 的固定枚举值
//	time10.DATA  当前时间
func (s *WechatMPSender) buildQuotaFields(event *domain.NotifyEvent) map[string]msgpush.TemplateMessageData {
	const thingMax = 20
	userName := "-"
	if event.Payload.UserName != "" {
		userName = truncateRune(event.Payload.UserName, thingMax)
	}
	return map[string]msgpush.TemplateMessageData{
		"thing17": {Value: "MonkeyCode"},
		"thing8":  {Value: userName},
		"const4":  {Value: quotaReason(event.EventType)},
		"time10":  {Value: time.Now().Format("2006-01-02 15:04:05")},
	}
}

func quotaReason(t consts.NotifyEventType) string {
	switch t {
	case consts.NotifyEventQuotaRefreshed:
		return "会员免费额度已重置"
	case consts.NotifyEventQuotaBasicExhausted:
		return "今日基础模型额度已用尽"
	case consts.NotifyEventQuotaProExhausted:
		return "今日专业模型额度已用尽"
	case consts.NotifyEventQuotaUltraExhausted:
		return "今日旗舰模型额度已用尽"
	}
	return "-"
}

// buildFields 把事件 payload 抽成微信模板的 5 个字段。
// thing3/thing25 是这个模板的固定文案；time2 始终是 now；
// thing16 (任务名称) 按 rune 截到 20 字符；time35 优先用 ExpiresAt。
func (s *WechatMPSender) buildFields(event *domain.NotifyEvent, msg Message) (thing16, thing3, time2, thing25, time35 string) {
	const thingMax = 20
	nowStr := time.Now().Format("2006-01-02 15:04:05")

	thing3 = "任务长期不使用，即将自动终止"
	thing25 = "到期前打开任务继续对话即可重新激活"
	time2 = nowStr

	defer func() {
		thing16 = truncateRune(thing16, thingMax)
		if thing16 == "" {
			thing16 = "-"
		}
		if time35 == "" {
			time35 = nowStr
		}
	}()

	if event == nil {
		// Test 路径或 event 缺失时的兜底
		thing16 = msg.Title
		return
	}

	p := event.Payload
	switch {
	case p.TaskTitle != "":
		thing16 = p.TaskTitle
	case p.TaskSummary != "":
		thing16 = p.TaskSummary
	default:
		thing16 = p.TaskContent
	}

	if p.ExpiresAt != nil {
		time35 = p.ExpiresAt.Format("2006-01-02 15:04:05")
	} else {
		time35 = event.OccurredAt.Format("2006-01-02 15:04:05")
	}
	return
}

// truncateRune 按字符（rune）数截断，避免中文被砍半字符。
// 超长时末尾用 "…" 占一个字符位。
func truncateRune(s string, max int) string {
	if max <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	if max == 1 {
		return "…"
	}
	return string(r[:max-1]) + "…"
}
