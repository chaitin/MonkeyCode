package template

import (
	"fmt"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/channel"
)

type QuotaUltraExhaustedRenderer struct{}

func (r *QuotaUltraExhaustedRenderer) EventType() consts.NotifyEventType {
	return consts.NotifyEventQuotaUltraExhausted
}

func (r *QuotaUltraExhaustedRenderer) Render(event *domain.NotifyEvent) (channel.Message, error) {
	title := "⛔ 今日旗舰模型额度已耗尽"
	body := fmt.Sprintf("### %s\n\n", title)
	if event.Payload.UserName != "" {
		body += fmt.Sprintf("**账户**: %s\n\n", event.Payload.UserName)
	}
	body += "今日旗舰模型免费额度已用完，请等待明日刷新。\n\n"
	body += fmt.Sprintf("**时间**: %s", event.OccurredAt.Format("2006-01-02 15:04:05"))
	return channel.Message{Title: title, Body: body}, nil
}
