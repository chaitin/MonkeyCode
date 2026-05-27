package template

import (
	"fmt"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/channel"
)

type QuotaProExhaustedRenderer struct{}

func (r *QuotaProExhaustedRenderer) EventType() consts.NotifyEventType {
	return consts.NotifyEventQuotaProExhausted
}

func (r *QuotaProExhaustedRenderer) Render(event *domain.NotifyEvent) (channel.Message, error) {
	title := "⛔ 今日专业模型额度已耗尽"
	body := fmt.Sprintf("### %s\n\n", title)
	if event.Payload.UserName != "" {
		body += fmt.Sprintf("**账户**: %s\n\n", event.Payload.UserName)
	}
	body += "今日专业模型免费额度已用完，可升级旗舰会员或等待明日刷新。\n\n"
	body += fmt.Sprintf("**时间**: %s", event.OccurredAt.Format("2006-01-02 15:04:05"))
	return channel.Message{Title: title, Body: body}, nil
}
