package biz

import (
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/public"
	"github.com/chaitin/MonkeyCode/backend/biz/team"
	"github.com/chaitin/MonkeyCode/backend/biz/user"
)

// RegisterAll 注册所有 biz 模块
func RegisterAll(i *do.Injector) error {
	// 注册 public 模块
	if err := public.RegisterPublic(i); err != nil {
		return err
	}

	// 注册 user 模块
	if err := user.RegisterUser(i); err != nil {
		return err
	}

	// 注册 team 模块
	if err := team.RegisterTeam(i); err != nil {
		return err
	}

	return nil
}
