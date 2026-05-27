package template

import (
	"fmt"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/channel"
)

type QuotaRefreshedRenderer struct{}

func (r *QuotaRefreshedRenderer) EventType() consts.NotifyEventType {
	return consts.NotifyEventQuotaRefreshed
}

func (r *QuotaRefreshedRenderer) Render(event *domain.NotifyEvent) (channel.Message, error) {
	title := "💎 会员免费额度已刷新"
	body := fmt.Sprintf("### %s\n\n", title)
	if event.Payload.UserName != "" {
		body += fmt.Sprintf("**账户**: %s\n\n", event.Payload.UserName)
	}
	body += "今日免费额度已重置，欢迎继续使用 MonkeyCode。\n\n"
	body += fmt.Sprintf("**时间**: %s", event.OccurredAt.Format("2006-01-02 15:04:05"))
	return channel.Message{Title: title, Body: body}, nil
}
