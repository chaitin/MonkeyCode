// Package atomgit 提供 atomgit (https://atomgit.com) 客户端。
//
// 鉴权: HTTP Header `Authorization: Bearer <token>`, PAT 和 OAuth access_token 共用此格式。
// 所有 OpenAPI 调用走 https://api.atomgit.com + `/api/v5/` 前缀 (后端复用 GitCode/Gitee
// 那套, 跟 docs.atomgit.com 上写的裸路径文档对不上)。仓库以 {owner}/{repo} 两段路径定位。
package atomgit

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

// Atomgit 客户端
type Atomgit struct {
	client *request.Client
	logger *slog.Logger
	host   string // OpenAPI host, 如 api.atomgit.com
	scheme string
}

// NewAtomgit 创建 atomgit 客户端。
//   - baseURL: OpenAPI 域名 (含 scheme), 空则使用默认 https://api.atomgit.com
func NewAtomgit(baseURL string, logger *slog.Logger) *Atomgit {
	scheme, host := normalizeBase(baseURL, DefaultAPIHost)
	return &Atomgit{
		logger: logger.With("module", "atomgit"),
		host:   host,
		scheme: scheme,
		client: request.NewClient(scheme, host, 30*time.Second),
	}
}

// BaseURL 返回 OpenAPI base URL
func (a *Atomgit) BaseURL() string {
	return a.scheme + "://" + a.host
}

func (a *Atomgit) authHeader(token string) request.Header {
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

// ParseRepoPath 从仓库 URL 解析出 owner / repo。
//
// 支持以下形式:
//
//	https://atomgit.com/{owner}/{repo}.git
//	https://atomgit.com/{owner}/{repo}
//	git@atomgit.com:{owner}/{repo}.git
func ParseRepoPath(repoURL string) (owner, repo string, err error) {
	raw := strings.TrimSpace(repoURL)
	raw = strings.TrimSuffix(raw, ".git")
	if raw == "" {
		return "", "", fmt.Errorf("empty repo url")
	}

	if strings.HasPrefix(raw, "git@") {
		at := strings.Index(raw, "@")
		col := strings.Index(raw, ":")
		if col <= at {
			return "", "", fmt.Errorf("invalid atomgit ssh url: %s", repoURL)
		}
		return splitOwnerRepo(strings.Trim(raw[col+1:], "/"), repoURL)
	}

	u, perr := url.Parse(raw)
	if perr != nil {
		return "", "", fmt.Errorf("parse atomgit url: %w", perr)
	}
	return splitOwnerRepo(strings.Trim(u.Path, "/"), repoURL)
}

func splitOwnerRepo(path, raw string) (string, string, error) {
	parts := strings.Split(path, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("invalid atomgit url, expect owner/repo: %s", raw)
	}
	return parts[0], parts[1], nil
}

// CheckPAT 校验 token (PAT 或 OAuth access_token) 对指定仓库的可访问性。
//
// 通过 GET /api/v5/repos/{owner}/{repo} 验证。
func (a *Atomgit) CheckPAT(ctx context.Context, token, repoURL string) (bool, *domain.BindRepository, error) {
	owner, repo, err := ParseRepoPath(repoURL)
	if err != nil {
		return false, nil, err
	}
	r, err := a.getRepo(ctx, token, owner, repo)
	if err != nil {
		return false, nil, err
	}
	if r == nil || (r.ID == 0 && r.FullName == "" && r.Name == "") {
		return false, nil, fmt.Errorf("repository not found or token has no access")
	}
	web := firstNonEmpty(r.WebURL, r.HTTPURL)
	if web == "" {
		web = "https://" + DefaultWebHost + "/" + owner + "/" + repo
	}
	full := r.FullName
	if full == "" {
		full = owner + "/" + repo
	}
	return true, &domain.BindRepository{
		RepoID:          fmt.Sprintf("%d", r.ID),
		RepoName:        firstNonEmpty(r.Name, repo),
		FullName:        full,
		RepoURL:         web,
		RepoDescription: r.Description,
		IsPrivate:       r.Private,
		Platform:        "atomgit",
	}, nil
}

// getRepo GET /api/v5/repos/{owner}/{repo}
func (a *Atomgit) getRepo(ctx context.Context, token, owner, repo string) (*Repository, error) {
	if owner == "" || repo == "" {
		return nil, fmt.Errorf("atomgit: missing owner/repo")
	}
	path := APIPrefix + "/repos/" + url.PathEscape(owner) + "/" + url.PathEscape(repo)
	r, err := request.Get[Repository](a.client, ctx, path,
		request.WithHeader(a.authHeader(token)))
	if err != nil {
		return nil, fmt.Errorf("get atomgit repo: %w", err)
	}
	return r, nil
}

// UserInfo 实现 GitClienter 接口。
//
// GET /api/v5/user 返回当前用户详情。
func (a *Atomgit) UserInfo(ctx context.Context, token string) (*domain.PlatformUserInfo, error) {
	user, err := a.fetchCurrentUser(ctx, token)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return &domain.PlatformUserInfo{}, nil
	}
	return &domain.PlatformUserInfo{
		Name: firstNonEmpty(user.Name, user.Login),
	}, nil
}

// fetchCurrentUser GET /api/v5/user, 内部复用
func (a *Atomgit) fetchCurrentUser(ctx context.Context, token string) (*User, error) {
	user, err := request.Get[User](a.client, ctx, APIPrefix+"/user",
		request.WithHeader(a.authHeader(token)))
	if err != nil {
		return nil, fmt.Errorf("get atomgit user: %w", err)
	}
	return user, nil
}

// Repositories 列出当前 token 所属用户可访问的仓库。
//
// 走 GET /api/v5/user/repos (Gitee 风格, 拿当前 token 用户的全部仓库,
// 包括所属组织的仓库)。上限 50 页 = 5000 个仓库。
func (a *Atomgit) Repositories(ctx context.Context, opts *domain.RepositoryOptions) ([]domain.AuthRepository, error) {
	result := make([]domain.AuthRepository, 0, 64)
	page, perPage := 1, 100
	apiPath := APIPrefix + "/user/repos"
	for {
		query := request.Query{
			"page":     fmt.Sprintf("%d", page),
			"per_page": fmt.Sprintf("%d", perPage),
		}
		repos, err := request.Get[[]*Repository](a.client, ctx, apiPath,
			request.WithHeader(a.authHeader(opts.Token)),
			request.WithQuery(query),
		)
		if err != nil {
			return nil, fmt.Errorf("list atomgit repositories: %w", err)
		}
		if repos == nil || len(*repos) == 0 {
			break
		}
		for _, r := range *repos {
			if r == nil {
				continue
			}
			full := r.FullName
			if full == "" {
				full = r.Name
			}
			web := firstNonEmpty(r.WebURL, r.HTTPURL)
			if web == "" && full != "" {
				web = "https://" + DefaultWebHost + "/" + full
			}
			result = append(result, domain.AuthRepository{
				FullName:    full,
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

// rawRequest 透传 HTTP 调用, 用于二进制响应 (如归档下载)。
func (a *Atomgit) rawRequest(ctx context.Context, method, fullURL, token string) (*http.Response, error) {
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
		return nil, fmt.Errorf("atomgit %s %s returned %d: %s", method, fullURL, resp.StatusCode, parseError(body))
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
		if er.ErrorDescription != "" {
			return er.ErrorDescription
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
