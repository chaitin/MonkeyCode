package template

import (
	"fmt"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/channel"
)

type TaskEndedRenderer struct{}

func (r *TaskEndedRenderer) EventType() consts.NotifyEventType {
	return consts.NotifyEventTaskEnded
}

func (r *TaskEndedRenderer) Render(event *domain.NotifyEvent) (channel.Message, error) {
	p := event.Payload
	title := "✅ 对话完成"
	body := fmt.Sprintf("### %s\n\n", title)
	if p.UserName != "" {
		body += fmt.Sprintf("**用户**: %s\n\n", p.UserName)
	}
	if p.TaskContent != "" {
		body += fmt.Sprintf("**对话内容**: %s\n\n", truncate(p.TaskContent, 200))
	}
	if p.RepoURL != "" {
		body += fmt.Sprintf("**仓库**: %s\n\n", p.RepoURL)
	}
	if p.ModelName != "" {
		body += fmt.Sprintf("**模型**: %s\n\n", p.ModelName)
	}
	if p.VMName != "" {
		body += fmt.Sprintf("**开发环境**: %s\n\n", p.VMName)
	}
	if spec := formatVMSpec(p); spec != "" {
		body += fmt.Sprintf("**配置**: %s\n\n", spec)
	}
	if p.TaskURL != "" {
		body += fmt.Sprintf("**详情**: [查看任务](%s)\n\n", p.TaskURL)
	}
	body += fmt.Sprintf("**时间**: %s", event.OccurredAt.Format("2006-01-02 15:04:05"))
	return channel.Message{Title: title, Body: body}, nil
}
