package user

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/user/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/user/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/user/usecase"
)

// RegisterUser 注册 user 模块
func RegisterUser(i *do.Injector) {
	do.Provide(i, repo.NewUserRepo)
	do.Provide(i, usecase.NewUserUsecase)
	do.Provide(i, v1.NewAuthHandler)
	do.MustInvoke[*v1.AuthHandler](i)
}
