package channel

import (
	"context"
	"fmt"
	"log/slog"
	"time"
	"unicode/utf8"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/msgpush"
)

// WechatMPSender 微信公众号模板消息推送。
//
// 微信公众号模板消息是强 schema 的结构化推送（thing 字段≤20 字符，
// 不支持 markdown），与钉钉/飞书那种自由 markdown 渠道完全不同，
// 所以这里不复用 renderer 输出的 msg.Body，而是直接从 event.Payload
// 抽字段、按字段类型 truncate、组装到模板字段中。
//
// 当前公众号后台只注册了一个通用模板：
//
//	thing2.DATA → 服务名称（事件类型描述）
//	thing5.DATA → 服务器（受影响实体名）
//	time3.DATA  → 发生时间
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

	thing2, thing5, time3 := s.buildFields(event, msg)
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
		"thing2", thing2,
		"thing5", thing5,
		"time3", time3,
		"url", url,
	)

	err := s.wechatClient.SendTemplateMessage(ctx, &msgpush.TemplateMessage{
		ToUser:     openID,
		TemplateID: s.cfg.Wechat.MP.TemplateID,
		URL:        url,
		Data: map[string]msgpush.TemplateMessageData{
			"thing2": {Value: thing2},
			"thing5": {Value: thing5},
			"time3":  {Value: time3},
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

// buildFields 把事件 payload 抽成微信模板的三个字段，每个 thing 字段都按 rune 截到 20 字符内。
func (s *WechatMPSender) buildFields(event *domain.NotifyEvent, msg Message) (thing2, thing5, time3 string) {
	const thingMax = 20

	defer func() {
		thing2 = truncateRune(thing2, thingMax)
		thing5 = truncateRune(thing5, thingMax)
		if thing2 == "" {
			thing2 = "-"
		}
		if thing5 == "" {
			thing5 = "-"
		}
		if time3 == "" {
			time3 = time.Now().Format("2006-01-02 15:04:05")
		}
	}()

	if event == nil {
		// Test 路径或 event 缺失时的兜底
		thing2 = msg.Title
		thing5 = firstLine(msg.Body)
		return
	}

	p := event.Payload
	switch event.EventType {
	case consts.NotifyEventVMExpiringSoon:
		// LeadSeconds 由事件源（vmidle）显式塞值；wechat 档由 cfg.VMIdle.RecycleWarnWechatLeadSeconds
		// 决定，可配任意 N 档（含非整时/整分值如 7000s），所以这里按"小时+分钟"复合单位拼装；
		// 不足 1 分钟才落回"秒"，<=0 走通用文案。
		if p.LeadSeconds > 0 {
			d := time.Duration(p.LeadSeconds) * time.Second
			h, m := int(d/time.Hour), int((d%time.Hour)/time.Minute)
			var dur string
			if h > 0 {
				dur += fmt.Sprintf("%d小时", h)
			}
			if m > 0 {
				dur += fmt.Sprintf("%d分钟", m)
			}
			if dur == "" {
				dur = fmt.Sprintf("%d秒", p.LeadSeconds)
			}
			thing2 = "开发环境" + dur + "后即将被回收"
		} else {
			thing2 = "开发环境即将回收"
		}
		// thing5（"服务器"字段）优先用 task summary（LLM 生成的简短总结，最贴近"这个环境在做什么"），
		// 没有就退到 task content（用户原始输入，可能较长，靠 truncateRune 截断），
		// 都没有就退到 VMName 兜底（test-push 等场景）。
		// 如果主信息（summary/content）字数不足 20 还有富余，再拼上 VMName 提供 VM 上下文，
		// 末尾仍由 truncateRune 兜底截断到 thingMax。
		var base string
		switch {
		case p.TaskSummary != "":
			base = p.TaskSummary
		case p.TaskContent != "":
			base = p.TaskContent
		default:
			base = p.VMName
		}
		if base != p.VMName && p.VMName != "" && utf8.RuneCountInString(base) < thingMax {
			thing5 = base + " " + p.VMName
		} else {
			thing5 = base
		}
		if p.ExpiresAt != nil {
			time3 = p.ExpiresAt.Format("2006-01-02 15:04:05")
		} else {
			time3 = event.OccurredAt.Format("2006-01-02 15:04:05")
		}

	case consts.NotifyEventTaskCreated:
		thing2 = "任务已创建"
		thing5 = p.TaskContent
		time3 = event.OccurredAt.Format("2006-01-02 15:04:05")

	case consts.NotifyEventTaskEnded:
		thing2 = "任务对话完成"
		thing5 = p.TaskContent
		time3 = event.OccurredAt.Format("2006-01-02 15:04:05")

	default:
		thing2 = msg.Title
		thing5 = firstLine(msg.Body)
		time3 = event.OccurredAt.Format("2006-01-02 15:04:05")
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

func firstLine(s string) string {
	for i, c := range s {
		if c == '\n' {
			return s[:i]
		}
	}
	return s
}
