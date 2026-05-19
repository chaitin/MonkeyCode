package biz

import (
	"context"

	"github.com/google/uuid"
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
	"github.com/chaitin/MonkeyCode/backend/biz/subscription"
	"github.com/chaitin/MonkeyCode/backend/biz/task"
	"github.com/chaitin/MonkeyCode/backend/biz/team"
	"github.com/chaitin/MonkeyCode/backend/biz/uploader"
	"github.com/chaitin/MonkeyCode/backend/biz/user"
	"github.com/chaitin/MonkeyCode/backend/biz/vmidle"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
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
	subscription.ProvideSubscription(i)
	uploader.ProvideUploader(i)
	llmproxy.ProvideLLMProxy(i)
	static.ProviderStatic(i)
	do.ProvideValue[domain.TaskHook](i, &taskhook{})
}

func InvokeOpenSource(i *do.Injector) {
	subscription.InvokeSubscription(i)
	uploader.InvokeUploader(i)
	llmproxy.InvokeLLMProxy(i)
	static.InvokeStatic(i)
}

type taskhook struct{}

// GetMaxConcurrent implements [domain.TaskHook].
func (t *taskhook) GetMaxConcurrent(ctx context.Context, uid uuid.UUID) (int, error) {
	return 3, nil
}

// GetSystemPrompt implements [domain.TaskHook].
func (t *taskhook) GetSystemPrompt(ctx context.Context, taskType consts.TaskType, subType consts.TaskSubType) (string, error) {
	return "", nil
}

// GitTask implements [domain.TaskHook].
func (t *taskhook) GitTask(ctx context.Context, id uuid.UUID) (*domain.GitTask, error) {
	return &domain.GitTask{}, nil
}

// OnTaskCreated implements [domain.TaskHook].
func (t *taskhook) OnTaskCreated(ctx context.Context, task *domain.ProjectTask) error {
	return nil
}

var _ domain.TaskHook = &taskhook{}
