package team

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/team/handler/http/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/team/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/team/usecase"
)

// ProvideTeam 注册 team 模块的服务工厂
func ProvideTeam(i *do.Injector) {
	do.Provide(i, repo.NewTeamGroupUserRepo)
	do.Provide(i, repo.NewAuditRepo)
	do.Provide(i, usecase.NewTeamGroupUserUsecase)
	do.Provide(i, usecase.NewAuditUsecase)
	do.Provide(i, repo.NewTeamModelRepo)
	do.Provide(i, usecase.NewTeamModelUsecase)
	do.Provide(i, v1.NewTeamModelHandler)
	do.Provide(i, repo.NewTeamImageRepo)
	do.Provide(i, usecase.NewTeamImageUsecase)
	do.Provide(i, v1.NewTeamImageHandler)
	do.Provide(i, repo.NewTeamHostRepo)
	do.Provide(i, usecase.NewTeamHostUsecase)
	do.Provide(i, v1.NewTeamHostHandler)
	do.Provide(i, v1.NewTeamGroupUserHandler)
}

// InvokeTeam 触发 team 模块的 handler 初始化
func InvokeTeam(i *do.Injector) {
	_, err := do.Invoke[*v1.TeamGroupUserHandler](i)
	if err != nil {
		panic(err)
	}
	do.MustInvoke[*v1.TeamModelHandler](i)
	do.MustInvoke[*v1.TeamImageHandler](i)
	do.MustInvoke[*v1.TeamHostHandler](i)
}
