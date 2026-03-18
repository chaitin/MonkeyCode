package template

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/channel"
)

type VMExpiringSoonRenderer struct{}

func (r *VMExpiringSoonRenderer) EventType() consts.NotifyEventType {
	return consts.NotifyEventVMExpiringSoon
}

func (r *VMExpiringSoonRenderer) Render(event *domain.NotifyEvent) (channel.Message, error) {
	p := event.Payload
	remaining := "即将"
	if p.ExpiresAt != nil {
		minutes := int(math.Ceil(time.Until(*p.ExpiresAt).Minutes()))
		if minutes > 0 {
			remaining = fmt.Sprintf("%d分钟后", minutes)
		}
	}
	title := fmt.Sprintf("⏰ 开发环境%s回收", remaining)
	body := fmt.Sprintf("### %s\n\n", title)
	if p.UserName != "" {
		body += fmt.Sprintf("**用户**: %s\n\n", p.UserName)
	}
	if p.TaskContent != "" {
		body += fmt.Sprintf("**任务内容**: %s\n\n", truncate(p.TaskContent, 200))
	}
	if p.RepoURL != "" {
		body += fmt.Sprintf("**仓库**: %s\n\n", p.RepoURL)
	}
	if p.ModelName != "" {
		body += fmt.Sprintf("**模型**: %s\n\n", p.ModelName)
	}
	if p.VMName != "" {
		body += fmt.Sprintf("**名称**: %s\n\n", p.VMName)
	}
	if spec := formatVMSpec(p); spec != "" {
		body += fmt.Sprintf("**配置**: %s\n\n", spec)
	}
	if p.ExpiresAt != nil {
		body += fmt.Sprintf("**预计回收时间**: %s\n\n", p.ExpiresAt.Format("2006-01-02 15:04:05"))
	}
	if p.TaskURL != "" {
		body += fmt.Sprintf("**详情**: [查看任务](%s)\n\n", p.TaskURL)
	}
	body += "请及时保存工作进度。"
	return channel.Message{Title: title, Body: body}, nil
}

func formatVMSpec(p domain.NotifyEventPayload) string {
	var parts []string
	if p.VMArch != "" {
		parts = append(parts, p.VMArch)
	}
	if p.VMCores > 0 {
		parts = append(parts, fmt.Sprintf("%d核", p.VMCores))
	}
	if p.VMMemory > 0 {
		parts = append(parts, formatMemory(p.VMMemory))
	}
	if p.VMOS != "" {
		parts = append(parts, p.VMOS)
	}
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, " / ")
}

func formatMemory(bytes int64) string {
	const (
		mb = 1024 * 1024
		gb = 1024 * mb
	)
	if bytes >= gb {
		v := float64(bytes) / float64(gb)
		if v == float64(int64(v)) {
			return fmt.Sprintf("%dGB", int64(v))
		}
		return fmt.Sprintf("%.1fGB", v)
	}
	return fmt.Sprintf("%dMB", bytes/int64(mb))
}
