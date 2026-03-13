package user

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/user/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/user/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/user/usecase"
)

// RegisterUser 注册 user 模块
func RegisterUser(i *do.Injector) error {
	// 注册 repo
	do.Provide(i, repo.NewUserRepo)

	// 注册 usecase
	do.Provide(i, usecase.NewUserUsecase)

	// 注册 handler（会自动注册路由）
	do.Provide(i, v1.NewAuthHandler)

	return nil
}
