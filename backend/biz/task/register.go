package task

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/task/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/task/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/task/service"
	"github.com/chaitin/MonkeyCode/backend/biz/task/usecase"
)

// RegisterTask 注册 task 模块
func RegisterTask(i *do.Injector) {
	do.Provide(i, repo.NewTaskRepo)
	do.Provide(i, repo.NewGitTaskRepo)
	do.Provide(i, usecase.NewTaskUsecase)
	do.Provide(i, usecase.NewGitTaskUsecase)
	do.Provide(i, service.NewTaskSummaryService)
	do.Provide(i, v1.NewTaskHandler)
	do.MustInvoke[*v1.TaskHandler](i)
}
