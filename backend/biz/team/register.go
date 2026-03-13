package team

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/team/handler/http/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/team/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/team/usecase"
)

// RegisterTeam 注册 team 模块
func RegisterTeam(i *do.Injector) error {
	// 注册 repo
	do.Provide(i, repo.NewTeamGroupUserRepo)

	// 注册 usecase
	do.Provide(i, usecase.NewTeamGroupUserUsecase)

	// 注册 handler
	_, err := do.Invoke[v1.TeamGroupUserHandler](i)
	return err
}
