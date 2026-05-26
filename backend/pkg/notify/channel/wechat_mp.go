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
// 当前公众号后台只注册了一个用于 VM 即将到期提醒的模板：
//
//	thing16.DATA → 任务名称（TaskTitle ‖ TaskSummary ‖ TaskContent）
//	thing3.DATA  → 告警原因（固定文案）
//	time2.DATA   → 告警时间（now）
//	thing25.DATA → 处理建议（固定文案）
//	time35.DATA  → 到期时间（ExpiresAt）
//
// URL 字段：含 TaskID 时填 {BaseURL}/console/task/{TaskID}，让卡片可跳转。
type WechatMPSender struct {
	cfg          *config.Config
	wechatClient *msgpush.WechatClient
}

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

	thing16, thing3, time2, thing25, time35 := s.buildFields(event, msg)
	url := ""
	if event != nil {
		url = event.Payload.TaskURL
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
		"template_id", s.cfg.Wechat.MP.TemplateID,
		"event_type", eventType,
		"ref_id", refID,
		"thing16", thing16,
		"thing3", thing3,
		"time2", time2,
		"thing25", thing25,
		"time35", time35,
		"url", url,
	)

	err := s.wechatClient.SendTemplateMessage(ctx, &msgpush.TemplateMessage{
		ToUser:     openID,
		TemplateID: s.cfg.Wechat.MP.TemplateID,
		URL:        url,
		Data: map[string]msgpush.TemplateMessageData{
			"thing16": {Value: thing16},
			"thing3":  {Value: thing3},
			"time2":   {Value: time2},
			"thing25": {Value: thing25},
			"time35":  {Value: time35},
		},
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
