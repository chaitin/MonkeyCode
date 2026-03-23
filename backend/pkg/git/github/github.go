// Package github 提供 GitHub 客户端功能（PAT 模式，不含 GitHub App）
package github

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"

	"github.com/google/go-github/v74/github"
	"golang.org/x/oauth2"

	domainpkg "github.com/chaitin/MonkeyCode/backend/domain"
)

// Github GitHub 客户端（PAT 模式）
type Github struct {
	logger  *slog.Logger
	baseURL string
}

// NewGithub 创建 GitHub 客户端
func NewGithub(logger *slog.Logger) *Github {
	return &Github{
		logger:  logger.With("module", "github"),
		baseURL: "https://github.com",
	}
}

// newClientWithToken 使用 PAT 创建 GitHub 客户端
func newClientWithToken(ctx context.Context, token string) *github.Client {
	ts := oauth2.StaticTokenSource(&oauth2.Token{AccessToken: token})
	tc := oauth2.NewClient(ctx, ts)
	return github.NewClient(tc)
}

func parseRepoURL(repoURL string) (owner, repo string, err error) {
	repoURL = strings.TrimSuffix(repoURL, ".git")
	for _, prefix := range []string{"https://github.com/", "http://github.com/"} {
		repoURL = strings.TrimPrefix(repoURL, prefix)
	}
	parts := strings.Split(repoURL, "/")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("invalid repo url: %s", repoURL)
	}
	return parts[0], parts[1], nil
}

// PlatformUserInfo 平台用户信息
type PlatformUserInfo struct {
	Name string `json:"name"`
}

// BindRepository 绑定仓库信息
type BindRepository struct {
	RepoID          string `json:"repo_id"`
	RepoName        string `json:"repo_name"`
	FullName        string `json:"full_name"`
	RepoURL         string `json:"repo_url"`
	RepoDescription string `json:"repo_description"`
	IsPrivate       bool   `json:"is_private"`
	Platform        string `json:"platform"`
}

// GetRepoInfoByPAT 根据 PAT 获取仓库信息
func (g *Github) GetRepoInfoByPAT(ctx context.Context, token string, repoURL string) (*github.Repository, error) {
	owner, repo, err := parseRepoURL(repoURL)
	if err != nil {
		return nil, err
	}
	client := newClientWithToken(ctx, token)
	repository, _, err := client.Repositories.Get(ctx, owner, repo)
	if err != nil {
		return nil, err
	}
	return repository, nil
}

// GetUserInfoByPAT 根据 PAT 获取用户信息
func (g *Github) GetUserInfoByPAT(ctx context.Context, token string) (*PlatformUserInfo, error) {
	client := newClientWithToken(ctx, token)
	user, _, err := client.Users.Get(ctx, "")
	if err != nil {
		return nil, err
	}
	return &PlatformUserInfo{
		Name: user.GetLogin(),
	}, nil
}

// CheckPAT 校验 PAT
func (g *Github) CheckPAT(ctx context.Context, token string, repoURL string) (bool, *BindRepository, error) {
	repository, err := g.GetRepoInfoByPAT(ctx, token, repoURL)
	if err != nil {
		return false, nil, err
	}
	if repository == nil {
		return false, nil, fmt.Errorf("repository not found")
	}

	permissions := repository.GetPermissions()
	if permissions["pull"] || permissions["push"] || permissions["admin"] {
		return true, &BindRepository{
			RepoID:          fmt.Sprintf("%d", repository.GetID()),
			RepoName:        repository.GetName(),
			FullName:        repository.GetFullName(),
			RepoURL:         repository.GetHTMLURL(),
			RepoDescription: repository.GetDescription(),
			IsPrivate:       repository.GetPrivate(),
			Platform:        "github",
		}, nil
	}
	return false, nil, fmt.Errorf("token has no access to this repository")
}

// ListBranches 获取仓库分支列表（PAT 模式）
func (g *Github) ListBranches(ctx context.Context, token, owner, repo string, page, perPage int) ([]*BranchInfo, error) {
	client := newClientWithToken(ctx, token)
	opts := &github.BranchListOptions{
		ListOptions: github.ListOptions{Page: page, PerPage: perPage},
	}
	branches, _, err := client.Repositories.ListBranches(ctx, owner, repo, opts)
	if err != nil {
		return nil, fmt.Errorf("list branches: %w", err)
	}
	result := make([]*BranchInfo, 0, len(branches))
	for _, b := range branches {
		result = append(result, &BranchInfo{Name: b.GetName()})
	}
	return result, nil
}

// GetRepoDescription 获取仓库描述（PAT 模式）
func (g *Github) GetRepoDescription(ctx context.Context, token, owner, repo string) (string, error) {
	client := newClientWithToken(ctx, token)
	r, _, err := client.Repositories.Get(ctx, owner, repo)
	if err != nil {
		return "", fmt.Errorf("get repo: %w", err)
	}
	return r.GetDescription(), nil
}

// GetAuthorizedRepositories 获取 PAT 可访问的仓库列表
func (g *Github) GetAuthorizedRepositories(ctx context.Context, token string) ([]domainpkg.AuthRepository, error) {
	client := newClientWithToken(ctx, token)
	opts := &github.RepositoryListByAuthenticatedUserOptions{
		ListOptions: github.ListOptions{PerPage: 100},
		Sort:        "updated",
	}
	var all []domainpkg.AuthRepository
	for {
		repos, resp, err := client.Repositories.ListByAuthenticatedUser(ctx, opts)
		if err != nil {
			return nil, fmt.Errorf("list repos: %w", err)
		}
		for _, r := range repos {
			all = append(all, domainpkg.AuthRepository{
				FullName:    r.GetFullName(),
				URL:         r.GetCloneURL(),
				Description: r.GetDescription(),
			})
		}
		if resp.NextPage == 0 {
			break
		}
		opts.Page = resp.NextPage
	}
	return all, nil
}

// DeleteWebhookByURL 根据 webhook URL 精确匹配删除 GitHub 仓库上的 webhook
func (g *Github) DeleteWebhookByURL(ctx context.Context, token, owner, repo, webhookURL string) error {
	client := newClientWithToken(ctx, token)
	opts := &github.ListOptions{Page: 1, PerPage: 100}
	for {
		hooks, resp, err := client.Repositories.ListHooks(ctx, owner, repo, opts)
		if err != nil {
			return fmt.Errorf("list hooks: %w", err)
		}
		for _, hook := range hooks {
			if hook.Config != nil && hook.Config.GetURL() == webhookURL {
				_, err := client.Repositories.DeleteHook(ctx, owner, repo, hook.GetID())
				if err != nil {
					return fmt.Errorf("delete hook %d: %w", hook.GetID(), err)
				}
				return nil
			}
		}
		if resp.NextPage == 0 {
			break
		}
		opts.Page = resp.NextPage
	}
	return nil
}

// CreateRepoWebhook 在仓库上注册 webhook
func (g *Github) CreateRepoWebhook(ctx context.Context, token, owner, repo, webhookURL, secret string, events []string) error {
	client := newClientWithToken(ctx, token)
	hook := &github.Hook{
		Config: &github.HookConfig{
			URL:         github.Ptr(webhookURL),
			ContentType: github.Ptr("json"),
			Secret:      github.Ptr(secret),
			InsecureSSL: github.Ptr("0"),
		},
		Events: events,
		Active: github.Ptr(true),
	}
	_, _, err := client.Repositories.CreateHook(ctx, owner, repo, hook)
	if err != nil {
		return fmt.Errorf("create repo webhook: %w", err)
	}
	return nil
}

// gitModeToInt converts a GitHub tree entry type to the integer mode convention
func gitModeToInt(entryType, _ string) int {
	switch entryType {
	case "tree", "dir":
		return 4
	case "blob", "file":
		return 1
	case "symlink":
		return 2
	case "commit":
		return 3
	}
	return 0
}

func baseName(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[i+1:]
		}
	}
	return path
}

func isBinaryContent(content []byte) bool {
	if len(content) == 0 {
		return false
	}
	check := content
	if len(check) > 8000 {
		check = check[:8000]
	}
	return http.DetectContentType(check) == "application/octet-stream" || containsNull(check)
}

func containsNull(b []byte) bool {
	return slices.Contains(b, 0)
}
