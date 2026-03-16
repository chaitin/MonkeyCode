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

	// 注册 handler
	do.Provide(i, v1.NewTeamGroupUserHandler)
	_, err := do.Invoke[*v1.TeamGroupUserHandler](i)
	return err
}
