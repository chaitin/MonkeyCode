package biz

import (
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/host"
	"github.com/chaitin/MonkeyCode/backend/biz/public"
	"github.com/chaitin/MonkeyCode/backend/biz/setting"
	"github.com/chaitin/MonkeyCode/backend/biz/team"
	"github.com/chaitin/MonkeyCode/backend/biz/user"
)

// RegisterAll 注册所有 biz 模块
func RegisterAll(i *do.Injector) error {
	public.RegisterPublic(i)
	user.RegisterUser(i)
	setting.RegisterSetting(i)

	// 注册 team 模块
	if err := team.RegisterTeam(i); err != nil {
		return err
	}

	// 注册 host 模块
	host.RegisterHost(i)

	return nil
}
