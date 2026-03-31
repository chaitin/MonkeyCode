package project

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/project/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/project/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/project/usecase"
)

// ProvideProject 注册 project 模块的服务工厂
func ProvideProject(i *do.Injector) {
	do.Provide(i, repo.NewProjectRepo)
	do.Provide(i, usecase.NewProjectUsecase)
	do.Provide(i, v1.NewProjectHandler)
}

// InvokeProject 触发 project 模块的 handler 初始化
func InvokeProject(i *do.Injector) {
	do.MustInvoke[*v1.ProjectHandler](i)
}
