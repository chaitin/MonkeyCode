package notify

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/notify/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/notify/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/notify/usecase"
)

// ProvideNotify 注册 notify 模块的服务工厂
func ProvideNotify(i *do.Injector) {
	do.Provide(i, repo.NewNotifyChannelRepo)
	do.Provide(i, repo.NewNotifySubscriptionRepo)
	do.Provide(i, repo.NewNotifySendLogRepo)
	do.Provide(i, usecase.NewNotifyChannelUsecase)
	do.Provide(i, v1.NewNotifyHandler)
}

// InvokeNotify 触发 notify 模块的 handler 初始化
func InvokeNotify(i *do.Injector) {
	do.MustInvoke[*v1.NotifyHandler](i)
}
