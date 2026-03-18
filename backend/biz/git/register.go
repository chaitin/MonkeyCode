package git

import (
	"github.com/samber/do"

	v1 "github.com/chaitin/MonkeyCode/backend/biz/git/handler/v1"
	"github.com/chaitin/MonkeyCode/backend/biz/git/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/git/usecase"
)

// RegisterGit 注册 git 模块
func RegisterGit(i *do.Injector) {
	// Repo
	do.Provide(i, repo.NewGitIdentityRepo)

	// Usecase
	do.Provide(i, usecase.NewGitIdentityUsecase)
	do.Provide(i, usecase.NewGithubAccessTokenUsecase)

	// Handler
	do.Provide(i, v1.NewGitIdentityHandler)
	do.MustInvoke[*v1.GitIdentityHandler](i)
}
