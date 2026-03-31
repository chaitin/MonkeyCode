package host

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/host/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/host/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/host/usecase"
)

// ProvideHost 注册 host 模块的服务工厂
func ProvideHost(i *do.Injector) {
	do.Provide(i, repo.NewHostRepo)
	do.Provide(i, usecase.NewHostUsecase)
	do.Provide(i, v1.NewHostHandler)
	do.Provide(i, v1.NewInternalHostHandler)
}

// InvokeHost 触发 host 模块的 handler 初始化
func InvokeHost(i *do.Injector) {
	do.MustInvoke[*v1.HostHandler](i)
	do.MustInvoke[*v1.InternalHostHandler](i)
}
