package user

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/user/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/user/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/user/usecase"
)

// ProvideUser 注册 user 模块的服务工厂
func ProvideUser(i *do.Injector) {
	do.Provide(i, repo.NewUserRepo)
	do.Provide(i, usecase.NewUserUsecase)
	do.Provide(i, v1.NewAuthHandler)
}

// InvokeUser 触发 user 模块的 handler 初始化
func InvokeUser(i *do.Injector) {
	do.MustInvoke[*v1.AuthHandler](i)
}
