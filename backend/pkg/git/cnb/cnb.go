// Package cnb 提供腾讯 CNB (Cloud Native Build, cnb.cool) 客户端。
//
// 鉴权: HTTP Header `Authorization: Bearer <token>`, PAT 和 OAuth access_token 共用此格式。
// 所有 OpenAPI 调用走 https://api.cnb.cool, 仓库以完整路径 slug (如 "cnb/test") 作为
// {repo} 路径参数, 无需组织 ID。
package cnb

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

// Cnb 客户端
type Cnb struct {
	client *request.Client
	logger *slog.Logger
	host   string // OpenAPI host, 如 api.cnb.cool
	scheme string
}

// NewCnb 创建 CNB 客户端。
//   - baseURL: OpenAPI 域名 (含 scheme), 空则使用默认 https://api.cnb.cool
func NewCnb(baseURL string, logger *slog.Logger) *Cnb {
	scheme, host := normalizeBase(baseURL, DefaultAPIHost)
	return &Cnb{
		logger: logger.With("module", "cnb"),
		host:   host,
		scheme: scheme,
		client: request.NewClient(scheme, host, 30*time.Second),
	}
}

// BaseURL 返回 OpenAPI base URL
func (c *Cnb) BaseURL() string {
	return c.scheme + "://" + c.host
}

func (c *Cnb) authHeader(token string) request.Header {
	return request.Header{
		"Authorization": "Bearer " + token,
		"Accept":        "application/json",
	}
}

func normalizeBase(input, fallback string) (scheme, host string) {
	scheme, host = "https", fallback
	if input == "" {
		return
	}
	if strings.HasPrefix(input, "http://") {
		scheme = "http"
		host = strings.TrimPrefix(input, "http://")
	} else if strings.HasPrefix(input, "https://") {
		host = strings.TrimPrefix(input, "https://")
	} else {
		host = input
	}
	host = strings.TrimSuffix(host, "/")
	return
}

// ParseRepoPath 从仓库 URL 解析出仓库 slug (owner/repo)。
//
// 支持以下形式:
//
//	https://cnb.cool/{owner}/{repo}.git
//	https://cnb.cool/{owner}/{repo}
//	git@cnb.cool:{owner}/{repo}.git
//
// owner 可以是多级 group (如 a/b/c), repo 是最后一段。
func ParseRepoPath(repoURL string) (string, error) {
	raw := strings.TrimSpace(repoURL)
	raw = strings.TrimSuffix(raw, ".git")
	if raw == "" {
		return "", fmt.Errorf("empty repo url")
	}

	// SSH 形式: git@host:owner/repo
	if strings.HasPrefix(raw, "git@") {
		at := strings.Index(raw, "@")
		col := strings.Index(raw, ":")
		if col <= at {
			return "", fmt.Errorf("invalid cnb ssh url: %s", repoURL)
		}
		path := strings.Trim(raw[col+1:], "/")
		if !strings.Contains(path, "/") {
			return "", fmt.Errorf("invalid cnb url, expect owner/repo: %s", repoURL)
		}
		return path, nil
	}

	u, perr := url.Parse(raw)
	if perr != nil {
		return "", fmt.Errorf("parse cnb url: %w", perr)
	}
	path := strings.Trim(u.Path, "/")
	if !strings.Contains(path, "/") {
		return "", fmt.Errorf("invalid cnb url, expect owner/repo: %s", repoURL)
	}
	return path, nil
}

// repoSlug 由 owner/repo 组装仓库 slug。Tree/Blob/Logs/Branches 调用方传入 Owner + Repo。
func repoSlug(owner, repo string) string {
	owner = strings.Trim(strings.TrimSpace(owner), "/")
	repo = strings.Trim(strings.TrimSpace(repo), "/")
	switch {
	case owner == "" && repo == "":
		return ""
	case owner == "":
		return repo
	case repo == "":
		return owner
	default:
		return owner + "/" + repo
	}
}

// CheckPAT 校验 token (PAT 或 OAuth access_token) 对指定仓库的可访问性。
//
// 通过 GET /{repo} 验证: 200 → 有权限, 4xx → 无权限或 token 失效。
func (c *Cnb) CheckPAT(ctx context.Context, token, repoURL string) (bool, *domain.BindRepository, error) {
	slug, err := ParseRepoPath(repoURL)
	if err != nil {
		return false, nil, err
	}
	repo, err := c.getRepo(ctx, token, slug)
	if err != nil {
		return false, nil, err
	}
	if repo == nil || (repo.ID == "" && repo.Path == "") {
		return false, nil, fmt.Errorf("repository not found or token has no access")
	}
	web := repo.WebURL
	if web == "" {
		web = "https://" + DefaultWebHost + "/" + slug
	}
	return true, &domain.BindRepository{
		RepoID:          repo.ID,
		RepoName:        firstNonEmpty(repo.Name, slug),
		FullName:        firstNonEmpty(repo.Path, slug),
		RepoURL:         web,
		RepoDescription: repo.Description,
		IsPrivate:       strings.EqualFold(repo.VisibilityLevel, "private"),
		Platform:        "cnb",
	}, nil
}

// getRepo GET /{repo} 获取仓库详情
func (c *Cnb) getRepo(ctx context.Context, token, slug string) (*Repository, error) {
	if slug == "" {
		return nil, fmt.Errorf("cnb: empty repo slug")
	}
	path := "/" + slug
	repo, err := request.Get[Repository](c.client, ctx, path,
		request.WithHeader(c.authHeader(token)))
	if err != nil {
		return nil, fmt.Errorf("get cnb repo: %w", err)
	}
	return repo, nil
}

// UserInfo 实现 GitClienter 接口。
//
// GET /user 返回当前用户详情。
func (c *Cnb) UserInfo(ctx context.Context, token string) (*domain.PlatformUserInfo, error) {
	user, err := request.Get[User](c.client, ctx, "/user",
		request.WithHeader(c.authHeader(token)))
	if err != nil {
		return nil, fmt.Errorf("get cnb user: %w", err)
	}
	if user == nil {
		return &domain.PlatformUserInfo{}, nil
	}
	return &domain.PlatformUserInfo{
		Name: firstNonEmpty(user.Nickname, user.Username),
	}, nil
}

// Repositories 列出当前 token 可访问的仓库 (按更新时间倒序)。
//
// GET /user/repos 翻页拉取, 上限 50 页 = 5000 个仓库。
func (c *Cnb) Repositories(ctx context.Context, opts *domain.RepositoryOptions) ([]domain.AuthRepository, error) {
	result := make([]domain.AuthRepository, 0, 64)
	page, perPage := 1, 100
	for {
		query := request.Query{
			"page":      fmt.Sprintf("%d", page),
			"page_size": fmt.Sprintf("%d", perPage),
			"order_by":  "updated_at",
			"desc":      "true",
		}
		repos, err := request.Get[[]*Repository](c.client, ctx, "/user/repos",
			request.WithHeader(c.authHeader(opts.Token)),
			request.WithQuery(query),
		)
		if err != nil {
			return nil, fmt.Errorf("list cnb repositories: %w", err)
		}
		if repos == nil || len(*repos) == 0 {
			break
		}
		for _, r := range *repos {
			if r == nil {
				continue
			}
			web := r.WebURL
			if web == "" && r.Path != "" {
				web = "https://" + DefaultWebHost + "/" + r.Path
			}
			result = append(result, domain.AuthRepository{
				FullName:    firstNonEmpty(r.Path, r.Name),
				URL:         web,
				Description: r.Description,
			})
		}
		if len(*repos) < perPage {
			break
		}
		page++
		if page > 50 {
			break
		}
	}
	return result, nil
}

// rawRequest 透传 HTTP 调用, 用于 OpenAPI 的二进制响应 (Archive)。
func (c *Cnb) rawRequest(ctx context.Context, method, fullURL, token string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, fullURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("cnb %s %s returned %d: %s", method, fullURL, resp.StatusCode, parseError(body))
	}
	return resp, nil
}

func parseError(body []byte) string {
	body = bytes.TrimSpace(body)
	if len(body) == 0 {
		return ""
	}
	var er errorResponse
	if err := json.Unmarshal(body, &er); err == nil {
		if er.Message != "" {
			return er.Message
		}
		if er.Msg != "" {
			return er.Msg
		}
		if er.Error != "" {
			return er.Error
		}
	}
	if len(body) > 512 {
		return string(body[:512])
	}
	return string(body)
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
