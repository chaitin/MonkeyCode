package git

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/git/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/git/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/git/usecase"
)

// ProvideGit 注册 git 模块的服务工厂
func ProvideGit(i *do.Injector) {
	do.Provide(i, repo.NewGitIdentityRepo)
	do.Provide(i, usecase.NewGitIdentityUsecase)
	do.Provide(i, usecase.NewGithubAccessTokenUsecase)
	do.Provide(i, v1.NewGitIdentityHandler)
	do.Provide(i, repo.NewGitBotRepo)
	do.Provide(i, usecase.NewGitBotUsecase)
	do.Provide(i, v1.NewGitBotHandler)
	do.Provide(i, v1.NewGithubWebhookHandler)
	do.Provide(i, v1.NewGitlabWebhookHandler)
	do.Provide(i, v1.NewGiteeWebhookHandler)
	do.Provide(i, v1.NewGiteaWebhookHandler)
}

// InvokeGit 触发 git 模块的 handler 初始化
func InvokeGit(i *do.Injector) {
	do.MustInvoke[*v1.GitIdentityHandler](i)
	do.MustInvoke[*v1.GitBotHandler](i)
	do.MustInvoke[*v1.GithubWebhookHandler](i)
	do.MustInvoke[*v1.GitlabWebhookHandler](i)
	do.MustInvoke[*v1.GiteeWebhookHandler](i)
	do.MustInvoke[*v1.GiteaWebhookHandler](i)
}
