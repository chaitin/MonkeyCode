package biz

import (
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/git"
	"github.com/chaitin/MonkeyCode/backend/biz/host"
	"github.com/chaitin/MonkeyCode/backend/biz/notify"
	"github.com/chaitin/MonkeyCode/backend/biz/project"
	"github.com/chaitin/MonkeyCode/backend/biz/public"
	"github.com/chaitin/MonkeyCode/backend/biz/setting"
	"github.com/chaitin/MonkeyCode/backend/biz/task"
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

	// 注册 notify 模块（需在 task 模块之前，因为 task 依赖 NotifyChannelRepo）
	notify.RegisterNotify(i)

	// 注册 task 模块（需在 git 模块之前，因为 webhook handler 依赖 GitTaskUsecase）
	task.RegisterTask(i)

	// 注册 git 模块
	git.RegisterGit(i)

	// 注册 project 模块
	project.RegisterProject(i)

	// 注册 host 模块
	host.RegisterHost(i)

	return nil
}
