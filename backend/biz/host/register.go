package host

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/host/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/host/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/host/usecase"
)

// RegisterHost 注册 host 模块
func RegisterHost(i *do.Injector) {
	// Repo
	do.Provide(i, repo.NewHostRepo)

	// Usecase
	do.Provide(i, usecase.NewHostUsecase)

	// Handler
	do.Provide(i, v1.NewHostHandler)
	do.MustInvoke[*v1.HostHandler](i)

	// Internal handler（taskflow 回调）
	do.Provide(i, v1.NewInternalHostHandler)
	do.MustInvoke[*v1.InternalHostHandler](i)
}
