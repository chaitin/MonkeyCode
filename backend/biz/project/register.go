package project

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/project/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/project/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/project/usecase"
)

// RegisterProject 注册 project 模块
func RegisterProject(i *do.Injector) {
	// Repo
	do.Provide(i, repo.NewProjectRepo)

	// Usecase
	do.Provide(i, usecase.NewProjectUsecase)

	// Handler
	do.Provide(i, v1.NewProjectHandler)
	do.MustInvoke[*v1.ProjectHandler](i)
}
