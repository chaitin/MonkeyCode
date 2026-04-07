package biz

import (
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/file"
	"github.com/chaitin/MonkeyCode/backend/biz/vmidle"
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
// 分两阶段：先 Provide（懒注册），再 Invoke（解析依赖），避免模块间循环依赖
func RegisterAll(i *do.Injector) error {
	// 阶段一：所有模块注册服务工厂（do.Provide，不触发依赖解析）
	notify.ProvideNotify(i)
	public.ProvidePublic(i)
	user.ProvideUser(i)
	setting.ProvideSetting(i)
	team.ProvideTeam(i)
	host.ProvideHost(i)
	task.ProvideTask(i)
	git.ProvideGit(i)
	project.ProvideProject(i)
	file.ProvideFile(i)
	vmidle.ProvideVMIdle(i)

	// 阶段二：统一触发 handler 初始化（do.MustInvoke，此时所有服务已注册）
	notify.InvokeNotify(i)
	public.InvokePublic(i)
	user.InvokeUser(i)
	setting.InvokeSetting(i)
	team.InvokeTeam(i)
	host.InvokeHost(i)
	task.InvokeTask(i)
	git.InvokeGit(i)
	project.InvokeProject(i)
	file.InvokeFile(i)
	vmidle.InvokeVMIdle(i)

	return nil
}
