// Package gitee 提供 Gitee 客户端功能
package gitee

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

// Gitee 客户端
type Gitee struct {
	client  *request.Client
	logger  *slog.Logger
	baseURL string
}

// NewGitee 创建新的 Gitee 客户端
func NewGitee(baseURL string, logger *slog.Logger) *Gitee {
	if baseURL == "" {
		baseURL = "https://gitee.com"
	}
	return &Gitee{
		logger:  logger.With("module", "gitee"),
		baseURL: baseURL,
		client: request.NewClient(
			"https",
			strings.TrimPrefix(baseURL, "https://"),
			time.Second*30,
		),
	}
}

// BaseURL 返回 Gitee base URL
func (g *Gitee) BaseURL() string {
	return g.baseURL
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

// ParseRepoPath 从仓库 URL 解析出 owner/repo
func ParseRepoPath(repoURL string) (owner, repo string, err error) {
	return parseGiteeRepoPath(repoURL)
}

func parseGiteeRepoPath(repoURL string) (string, string, error) {
	repoURL = strings.TrimSuffix(repoURL, ".git")
	repoURL = strings.TrimPrefix(repoURL, "https://gitee.com/")
	repoURL = strings.TrimPrefix(repoURL, "http://gitee.com/")
	repoURL = strings.TrimPrefix(repoURL, "git@gitee.com:")
	parts := strings.Split(repoURL, "/")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("invalid gitee repo url: %s", repoURL)
	}
	return parts[0], parts[1], nil
}

type giteeUserResponse struct {
	ID      int64  `json:"id"`
	Login   string `json:"login"`
	Name    string `json:"name"`
	Email   string `json:"email"`
	HTMLURL string `json:"html_url"`
	Avatar  string `json:"avatar_url"`
}

// GetRepoInfoByPAT 根据 PAT 获取仓库信息
func (g *Gitee) GetRepoInfoByPAT(ctx context.Context, token string, repoURL string) (*Repository, error) {
	owner, repo, err := parseGiteeRepoPath(repoURL)
	if err != nil {
		return nil, err
	}
	path := fmt.Sprintf("/api/v5/repos/%s/%s", owner, repo)
	query := map[string]string{"access_token": token}
	repoInfo, err := request.Get[Repository](g.client, ctx, path, request.WithQuery(query))
	if err != nil {
		return nil, fmt.Errorf("get repo info: %w", err)
	}
	return repoInfo, nil
}

// CheckPAT 校验 PAT
func (g *Gitee) CheckPAT(ctx context.Context, token string, repoURL string) (bool, *BindRepository, error) {
	repo, err := g.GetRepoInfoByPAT(ctx, token, repoURL)
	if err != nil {
		return false, nil, fmt.Errorf("get repo info: %w", err)
	}
	if repo == nil {
		return false, nil, fmt.Errorf("repository not found or invalid token")
	}
	if repo.Permission == nil {
		return false, nil, fmt.Errorf("no permission info returned")
	}
	if repo.Permission.Admin || repo.Permission.Push || repo.Permission.Pull {
		bindRepo := &BindRepository{
			RepoID:          fmt.Sprintf("%d", repo.ID),
			RepoName:        repo.Name,
			FullName:        repo.FullName,
			RepoURL:         repo.HTMLURL,
			RepoDescription: repo.Description,
			IsPrivate:       repo.Private,
			Platform:        "gitee",
		}
		return true, bindRepo, nil
	}
	return false, nil, fmt.Errorf("token has no access to this repository")
}

// GetUserInfoByPAT 根据 PAT 获取用户信息
func (g *Gitee) GetUserInfoByPAT(ctx context.Context, token string) (*PlatformUserInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://gitee.com/api/v5/user", nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "token "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request Gitee API: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status from Gitee API: %d", resp.StatusCode)
	}
	var user giteeUserResponse
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, fmt.Errorf("decode Gitee user response: %w", err)
	}
	return &PlatformUserInfo{
		Name: user.Login,
	}, nil
}

// ListUserReposByToken 使用指定 token 获取用户的仓库列表
func (g *Gitee) ListUserReposByToken(baseURL, token string, page, perPage int) ([]*Repository, error) {
	if perPage > 100 {
		perPage = 100
	}
	client := request.NewClient(
		"https",
		strings.TrimPrefix(baseURL, "https://"),
		time.Second*30,
	)
	path := "/api/v5/user/repos"
	query := map[string]string{
		"access_token": token,
		"page":         fmt.Sprintf("%d", page),
		"per_page":     fmt.Sprintf("%d", perPage),
		"sort":         "updated",
	}
	repos, err := request.Get[[]*Repository](client, context.Background(), path, request.WithQuery(query))
	if err != nil {
		return nil, fmt.Errorf("list user repos: %w", err)
	}
	return *repos, nil
}

// newRequestClientForToken 使用指定 token 创建 request client
func (g *Gitee) newRequestClientForToken(token string) *request.Client {
	return request.NewClient(
		"https",
		"gitee.com",
		time.Second*30,
	)
}
