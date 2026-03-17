package team

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/team/handler/http/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/team/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/team/usecase"
)

// RegisterTeam 注册 team 模块
func RegisterTeam(i *do.Injector) error {
	do.Provide(i, repo.NewTeamGroupUserRepo)
	do.Provide(i, repo.NewAuditRepo)
	do.Provide(i, usecase.NewTeamGroupUserUsecase)
	do.Provide(i, usecase.NewAuditUsecase)

	// 团队模型配置
	do.Provide(i, repo.NewTeamModelRepo)
	do.Provide(i, usecase.NewTeamModelUsecase)
	do.Provide(i, v1.NewTeamModelHandler)

	// 团队镜像配置
	do.Provide(i, repo.NewTeamImageRepo)
	do.Provide(i, usecase.NewTeamImageUsecase)
	do.Provide(i, v1.NewTeamImageHandler)

	// 团队宿主机
	do.Provide(i, repo.NewTeamHostRepo)
	do.Provide(i, usecase.NewTeamHostUsecase)
	do.Provide(i, v1.NewTeamHostHandler)

	// 注册 handler
	do.Provide(i, v1.NewTeamGroupUserHandler)
	_, err := do.Invoke[*v1.TeamGroupUserHandler](i)
	if err != nil {
		return err
	}
	do.MustInvoke[*v1.TeamModelHandler](i)
	do.MustInvoke[*v1.TeamImageHandler](i)
	do.MustInvoke[*v1.TeamHostHandler](i)
	return nil
}
