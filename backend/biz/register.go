package biz

import (
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/file"
	"github.com/chaitin/MonkeyCode/backend/biz/git"
	"github.com/chaitin/MonkeyCode/backend/biz/host"
	"github.com/chaitin/MonkeyCode/backend/biz/llmproxy"
	"github.com/chaitin/MonkeyCode/backend/biz/notify"
	"github.com/chaitin/MonkeyCode/backend/biz/project"
	"github.com/chaitin/MonkeyCode/backend/biz/public"
	"github.com/chaitin/MonkeyCode/backend/biz/setting"
	"github.com/chaitin/MonkeyCode/backend/biz/static"
	"github.com/chaitin/MonkeyCode/backend/biz/task"
	"github.com/chaitin/MonkeyCode/backend/biz/team"
	"github.com/chaitin/MonkeyCode/backend/biz/uploader"
	"github.com/chaitin/MonkeyCode/backend/biz/user"
	"github.com/chaitin/MonkeyCode/backend/biz/vmidle"
)

// RegisterAll 注册所有 biz 模块
// 分两阶段：先 Provide（懒注册），再 Invoke（解析依赖），避免模块间循环依赖
func RegisterAll(i *do.Injector) error {
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
	return nil
}

func InvokeAll(i *do.Injector) {
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
}

// RegisterOpenSource 注册仅在开源项目中使用的模块
func RegisterOpenSource(i *do.Injector) {
	uploader.ProvideUploader(i)
	llmproxy.ProvideLLMProxy(i)
	static.ProviderStatic(i)
}

func InvokeOpenSource(i *do.Injector) {
	uploader.InvokeUploader(i)
	llmproxy.InvokeLLMProxy(i)
	static.InvokeStatic(i)
}
