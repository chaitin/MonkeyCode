package notify

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/notify/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/notify/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/notify/usecase"
)

// RegisterNotify 注册 notify 模块
func RegisterNotify(i *do.Injector) {
	// Repo
	do.Provide(i, repo.NewNotifyChannelRepo)
	do.Provide(i, repo.NewNotifySubscriptionRepo)
	do.Provide(i, repo.NewNotifySendLogRepo)

	// Usecase
	do.Provide(i, usecase.NewNotifyChannelUsecase)

	// Handler
	do.Provide(i, v1.NewNotifyHandler)
	do.MustInvoke[*v1.NotifyHandler](i)
}
