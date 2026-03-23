// Package gitea 提供 Gitea 客户端功能
package gitea

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
)

// Gitea 客户端
type Gitea struct {
	logger  *slog.Logger
	baseURL string
}

// NewGitea 创建 Gitea 客户端
func NewGitea(logger *slog.Logger, baseURL string) *Gitea {
	if baseURL == "" {
		baseURL = "https://gitea.com"
	}
	baseURL = strings.TrimSuffix(baseURL, "/")
	return &Gitea{
		logger:  logger.With("module", "gitea"),
		baseURL: baseURL,
	}
}

// ParseRepoPath 从仓库 URL 解析出 owner/repo
func ParseRepoPath(repoURL string) (owner, repo string, err error) {
	return parseGiteaRepoPath(repoURL)
}

func parseGiteaRepoPath(repoURL string) (string, string, error) {
	repoURL = strings.TrimSuffix(repoURL, ".git")
	u, err := url.Parse(repoURL)
	if err != nil {
		return "", "", fmt.Errorf("invalid repo url: %w", err)
	}
	path := strings.TrimPrefix(u.Path, "/")
	parts := strings.Split(path, "/")
	if len(parts) < 2 {
		return "", "", fmt.Errorf("invalid repo path: %s", path)
	}
	return parts[0], parts[1], nil
}

type giteaUserResponse struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	FullName  string `json:"full_name"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
	HTMLURL   string `json:"html_url"`
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
func (g *Gitea) GetRepoInfoByPAT(ctx context.Context, baseURL, token string, repoURL string) (*GiteaRepository, error) {
	owner, repo, err := parseGiteaRepoPath(repoURL)
	if err != nil {
		return nil, err
	}
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s", baseURL, owner, repo)
	body, err := giteaAPIGet(ctx, apiURL, token)
	if err != nil {
		return nil, fmt.Errorf("get repository: %w", err)
	}
	var repository GiteaRepository
	if err := json.Unmarshal(body, &repository); err != nil {
		return nil, fmt.Errorf("unmarshal repository: %w", err)
	}
	return &repository, nil
}

// CheckPAT 校验 PAT 是否能访问对应仓库
func (g *Gitea) CheckPAT(ctx context.Context, baseURL, token string, repoURL string) (bool, *BindRepository, error) {
	repo, err := g.GetRepoInfoByPAT(ctx, baseURL, token, repoURL)
	if err != nil {
		return false, nil, err
	}
	if repo == nil {
		return false, nil, fmt.Errorf("repository not found or invalid token")
	}
	if repo.Permissions == nil {
		return false, nil, fmt.Errorf("no permission info returned")
	}
	if repo.Permissions.Admin || repo.Permissions.Push || repo.Permissions.Pull {
		bindRepo := &BindRepository{
			RepoID:          fmt.Sprintf("%d", repo.ID),
			RepoName:        repo.Name,
			FullName:        repo.FullName,
			RepoURL:         repo.HTMLURL,
			RepoDescription: repo.Description,
			IsPrivate:       repo.Private,
			Platform:        "gitea",
		}
		return true, bindRepo, nil
	}
	return false, nil, fmt.Errorf("token has no access to this repository")
}

// GetUserInfoByPAT 根据 PAT 获取用户信息
func (g *Gitea) GetUserInfoByPAT(ctx context.Context, baseURL, token string) (*PlatformUserInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/api/v1/user", nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "token "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request Gitea API: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status from Gitea API: %d", resp.StatusCode)
	}
	var user giteaUserResponse
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, fmt.Errorf("decode Gitea user response: %w", err)
	}
	return &PlatformUserInfo{
		Name: user.Login,
	}, nil
}

// GiteaRepository Gitea 仓库信息
type GiteaRepository struct {
	ID          int64              `json:"id"`
	Name        string             `json:"name"`
	FullName    string             `json:"full_name"`
	Description string             `json:"description"`
	Private     bool               `json:"private"`
	HTMLURL     string             `json:"html_url"`
	CloneURL    string             `json:"clone_url"`
	Permissions *GiteaPermissions  `json:"permissions"`
}

// GiteaPermissions Gitea 仓库权限
type GiteaPermissions struct {
	Admin bool `json:"admin"`
	Push  bool `json:"push"`
	Pull  bool `json:"pull"`
}
