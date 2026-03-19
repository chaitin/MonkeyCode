package git

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/git/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/git/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/git/usecase"
)

// RegisterGit 注册 git 模块
func RegisterGit(i *do.Injector) {
	// GitIdentity Repo
	do.Provide(i, repo.NewGitIdentityRepo)

	// GitIdentity Usecase
	do.Provide(i, usecase.NewGitIdentityUsecase)
	do.Provide(i, usecase.NewGithubAccessTokenUsecase)

	// GitIdentity Handler
	do.Provide(i, v1.NewGitIdentityHandler)
	do.MustInvoke[*v1.GitIdentityHandler](i)

	// GitBot Repo
	do.Provide(i, repo.NewGitBotRepo)

	// GitBot Usecase
	do.Provide(i, usecase.NewGitBotUsecase)

	// GitBot Handler
	do.Provide(i, v1.NewGitBotHandler)
	do.MustInvoke[*v1.GitBotHandler](i)

	// Webhook Handlers
	do.Provide(i, v1.NewGithubWebhookHandler)
	do.Provide(i, v1.NewGitlabWebhookHandler)
	do.Provide(i, v1.NewGiteeWebhookHandler)
	do.Provide(i, v1.NewGiteaWebhookHandler)
	do.MustInvoke[*v1.GithubWebhookHandler](i)
	do.MustInvoke[*v1.GitlabWebhookHandler](i)
	do.MustInvoke[*v1.GiteeWebhookHandler](i)
	do.MustInvoke[*v1.GiteaWebhookHandler](i)
}
