// Package codeup 提供阿里云云效 Codeup 客户端。
//
// 鉴权：HTTP Header `x-yunxiao-token: <PAT 或 OAuth access_token>`，统一走云效 OpenAPI（公共站
// openapi-rdc.aliyuncs.com）。绝大多数接口需要 organizationId 路径参数。
package codeup

import (
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

// Codeup 客户端
type Codeup struct {
	client  *request.Client
	logger  *slog.Logger
	openapi string // OpenAPI host，如 openapi-rdc.aliyuncs.com
	scheme  string
	orgID   string // 默认组织 ID；当 GitIdentity 已存储 OrganizationID 时注入
}

// NewCodeup 创建 Codeup 客户端。
//   - openapiBase: OpenAPI 域名（包含 scheme），空则使用默认 https://openapi-rdc.aliyuncs.com
//   - orgID: 组织 ID，可为空（CheckPAT / UserInfo / 自动解析时无需提前知道）
func NewCodeup(openapiBase, orgID string, logger *slog.Logger) *Codeup {
	scheme, host := normalizeBase(openapiBase, DefaultOpenAPIHost)
	return &Codeup{
		logger:  logger.With("module", "codeup"),
		openapi: host,
		scheme:  scheme,
		orgID:   orgID,
		client: request.NewClient(
			scheme,
			host,
			30*time.Second,
		),
	}
}

// BaseURL 返回 OpenAPI base URL
func (c *Codeup) BaseURL() string {
	return c.scheme + "://" + c.openapi
}

// OrgID 返回当前默认组织 ID（可能为空）
func (c *Codeup) OrgID() string { return c.orgID }

func (c *Codeup) authHeader(token string) request.Header {
	return request.Header{"x-yunxiao-token": token}
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

// ParseRepoPath 从仓库 URL 解析 orgId 和 repo 标识（groupPath/repoName）。
// 支持以下形式：
//   https://codeup.aliyun.com/{orgId}/{group}/{repo}.git
//   https://codeup.aliyun.com/{orgId}/{group}/{repo}
//   git@codeup.aliyun.com:{orgId}/{group}/{repo}.git
//   https://{orgId}.codeup.aliyun.com/{group}/{repo}.git
func ParseRepoPath(repoURL string) (orgID, identity string, err error) {
	raw := strings.TrimSpace(repoURL)
	raw = strings.TrimSuffix(raw, ".git")

	// SSH 形式：git@host:org/group/repo
	if strings.HasPrefix(raw, "git@") {
		at := strings.Index(raw, "@")
		col := strings.Index(raw, ":")
		if col <= at {
			return "", "", fmt.Errorf("invalid codeup ssh url: %s", repoURL)
		}
		path := raw[col+1:]
		return splitOrgAndIdentity(path, repoURL)
	}

	u, perr := url.Parse(raw)
	if perr != nil {
		return "", "", fmt.Errorf("parse codeup url: %w", perr)
	}
	host := u.Host
	path := strings.TrimPrefix(u.Path, "/")

	// 子域名形式：{orgId}.codeup.aliyun.com/{group}/{repo}
	if idx := strings.Index(host, ".codeup."); idx > 0 {
		orgID = host[:idx]
		identity = path
		if orgID == "" || identity == "" {
			return "", "", fmt.Errorf("invalid codeup subdomain url: %s", repoURL)
		}
		return orgID, identity, nil
	}

	// 路径形式：codeup.aliyun.com/{orgId}/{group}/{repo}
	return splitOrgAndIdentity(path, repoURL)
}

func splitOrgAndIdentity(path, raw string) (string, string, error) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 3 {
		return "", "", fmt.Errorf("invalid codeup url, expect orgId/group/repo: %s", raw)
	}
	orgID := parts[0]
	identity := strings.Join(parts[1:], "/")
	return orgID, identity, nil
}

// repoPath 返回 /oapi/v1/codeup/organizations/{orgId}/repositories/{repoIdent}
//
// 云效 OpenAPI 的 repositoryId 接受两种格式：
//   - 数字 ID（如 2813489）
//   - URL-encoded 全路径（如 60de7a6852743a5162b5f957%2FDemoRepo，即 {orgId}/{groupPath}/{repoName}）
//
// repoIdent 入参可以是「数字 ID」或「不含 orgId 前缀的 {groupPath}/{repoName}」。
// 这里识别全数字按数字 ID 直传；否则统一拼成全路径再 URL-encode。
func (c *Codeup) repoPath(orgID, repoIdent string) string {
	encoded := encodeRepoIdent(orgID, repoIdent)
	return fmt.Sprintf("/oapi/v1/codeup/organizations/%s/repositories/%s",
		url.PathEscape(orgID), encoded)
}

// encodeRepoIdent 把 repoIdent 编码为云效 OpenAPI 期望的 repositoryId 形式。
func encodeRepoIdent(orgID, repoIdent string) string {
	repoIdent = strings.TrimSpace(repoIdent)
	if repoIdent == "" {
		return ""
	}
	if isAllDigits(repoIdent) {
		return url.PathEscape(repoIdent)
	}
	// 已经带 orgId 前缀就不要重复拼
	prefix := orgID + "/"
	if !strings.HasPrefix(repoIdent, prefix) {
		repoIdent = prefix + repoIdent
	}
	return url.PathEscape(repoIdent)
}

// encodeFilePath 把文件路径编成云效 OpenAPI 文件接口期望的 path 段：URL-encode 后把 / 换成 %2F。
func encodeFilePath(p string) string {
	return strings.ReplaceAll(url.PathEscape(p), "/", "%2F")
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// resolveRepoCtx 解析当前 orgID 与 repo identity。
//
//   - orgID 优先用客户端构造时注入的；为空时用 token 调 ResolveOrgID 取 PAT 的第一个组织。
//   - identity 由 owner / repo 拼成「{groupPath}/{repoName}」形式（不含 orgId）。
func (c *Codeup) resolveRepoCtx(ctx context.Context, token, owner, repo string) (string, string, error) {
	orgID := c.orgID
	if orgID == "" {
		resolved, err := c.ResolveOrgID(ctx, token)
		if err != nil {
			return "", "", fmt.Errorf("resolve organization: %w", err)
		}
		orgID = resolved
	}
	identity := assembleIdentity(owner, repo)
	if identity == "" {
		return "", "", fmt.Errorf("missing repo identity")
	}
	return orgID, identity, nil
}

func assembleIdentity(owner, repo string) string {
	owner = strings.TrimSpace(owner)
	repo = strings.TrimSpace(repo)
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

// ListOrganizations 列出 PAT 所属的全部云效组织。
//
//	GET /oapi/v1/platform/organizations
//	Header: x-yunxiao-token
//
// 中心版/标准版均支持 PAT 调用，返回结构为 [{id, name, ...}]。
func (c *Codeup) ListOrganizations(ctx context.Context, token string) ([]*OrganizationItem, error) {
	orgs, err := request.Get[[]*OrganizationItem](c.client, ctx, "/oapi/v1/platform/organizations",
		request.WithHeader(c.authHeader(token)),
		request.WithQuery(request.Query{"perPage": "100"}),
	)
	if err != nil {
		return nil, fmt.Errorf("list organizations: %w", err)
	}
	if orgs == nil {
		return nil, nil
	}
	return *orgs, nil
}

// ResolveOrgID 取 PAT 所属的第一个组织的 ID。
//
// 多组织时只取第一个；用户若希望使用另一组织，可在编辑身份时手动覆盖 organization_id。
func (c *Codeup) ResolveOrgID(ctx context.Context, token string) (string, error) {
	orgs, err := c.ListOrganizations(ctx, token)
	if err != nil {
		return "", err
	}
	if len(orgs) == 0 {
		return "", fmt.Errorf("token has no organization")
	}
	return orgs[0].ID, nil
}

// GetRepoByIdentity 根据 group/repo 标识获取仓库信息
func (c *Codeup) GetRepoByIdentity(ctx context.Context, token, orgID, identity string) (*Repository, error) {
	if orgID == "" {
		return nil, fmt.Errorf("organization id is required")
	}
	path := c.repoPath(orgID, identity)
	repo, err := request.Get[Repository](c.client, ctx, path,
		request.WithHeader(c.authHeader(token)))
	if err != nil {
		return nil, fmt.Errorf("get repo: %w", err)
	}
	return repo, nil
}

// CheckPAT 校验 PAT。先解析 repoURL 得到 orgId + identity，再调 OpenAPI 验证可访问。
func (c *Codeup) CheckPAT(ctx context.Context, token, repoURL string) (bool, *domain.BindRepository, error) {
	orgID, identity, err := ParseRepoPath(repoURL)
	if err != nil {
		return false, nil, err
	}
	repo, err := c.GetRepoByIdentity(ctx, token, orgID, identity)
	if err != nil {
		return false, nil, err
	}
	if repo == nil || repo.ID == 0 {
		return false, nil, fmt.Errorf("repository not found or token has no access")
	}
	return true, &domain.BindRepository{
		RepoID:          fmt.Sprintf("%d", repo.ID),
		RepoName:        repo.Name,
		FullName:        firstNonEmpty(repo.PathWithNs, repo.NameWithNs, identity),
		RepoURL:         ensureCloneURL(repo.WebURL, repo.HTTPCloneURL),
		RepoDescription: repo.Description,
		IsPrivate:       strings.EqualFold(repo.Visibility, "private"),
		Platform:        "codeup",
	}, nil
}

// UserInfo 实现 GitClienter 接口。
//
// 云效 OpenAPI 没有提供仅凭 PAT 获取当前用户的接口（GetCurrentUser 系列均不存在）。
// 此处返回空名以满足接口约定；调用方需要时应当从 GitIdentity.Username 字段读取用户绑定时填写的名字。
func (c *Codeup) UserInfo(ctx context.Context, token string) (*domain.PlatformUserInfo, error) {
	return &domain.PlatformUserInfo{Name: ""}, nil
}

// Repositories 列出当前用户在组织内可访问的仓库
func (c *Codeup) Repositories(ctx context.Context, opts *domain.RepositoryOptions) ([]domain.AuthRepository, error) {
	orgID := c.orgID
	if orgID == "" {
		resolved, err := c.ResolveOrgID(ctx, opts.Token)
		if err != nil {
			return nil, fmt.Errorf("resolve organization: %w", err)
		}
		orgID = resolved
	}

	result := make([]domain.AuthRepository, 0, 64)
	page, perPage := 1, 100
	for {
		path := fmt.Sprintf("/oapi/v1/codeup/organizations/%s/repositories", url.PathEscape(orgID))
		query := request.Query{
			"page":    fmt.Sprintf("%d", page),
			"perPage": fmt.Sprintf("%d", perPage),
			"orderBy": "last_activity_at",
			"sort":    "desc",
		}
		repos, err := request.Get[[]*Repository](c.client, ctx, path,
			request.WithHeader(c.authHeader(opts.Token)),
			request.WithQuery(query),
		)
		if err != nil {
			return nil, fmt.Errorf("list codeup repositories: %w", err)
		}
		if repos == nil || len(*repos) == 0 {
			break
		}
		for _, r := range *repos {
			result = append(result, domain.AuthRepository{
				FullName:    firstNonEmpty(r.PathWithNs, r.NameWithNs, r.Name),
				URL:         ensureCloneURL(r.WebURL, r.HTTPCloneURL),
				Description: r.Description,
			})
		}
		if len(*repos) < perPage {
			break
		}
		page++
		if page > 50 { // 安全上限：5000 个仓库
			break
		}
	}
	return result, nil
}

// rawRequest 透传 HTTP 调用，用于 OpenAPI 之外的简单请求（如 webhook 删除）
func (c *Codeup) rawRequest(ctx context.Context, method, fullURL, token string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, fullURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-yunxiao-token", token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("codeup %s %s returned %d: %s", method, fullURL, resp.StatusCode, parseError(body))
	}
	return resp, nil
}

func parseError(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var er errorResponse
	if err := json.Unmarshal(body, &er); err == nil {
		if er.ErrorMessage != "" {
			return er.ErrorMessage
		}
		if er.Message != "" {
			return er.Message
		}
		if er.ErrorCode != "" {
			return er.ErrorCode
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

// ensureCloneURL 返回可被 git clone 使用的仓库 URL。
//
// 云效 Codeup 比较严格：仓库 URL 不带 .git 后缀时 git clone 会失败。OpenAPI 同时返回
// webUrl（站点 URL，无 .git）和 httpCloneUrl（克隆 URL，含 .git），但列表接口里 httpCloneUrl
// 不保证返回，所以优先用 httpCloneUrl，回退到 webUrl 时补上 .git。
func ensureCloneURL(webURL, httpCloneURL string) string {
	if httpCloneURL != "" {
		return httpCloneURL
	}
	if webURL == "" {
		return ""
	}
	if strings.HasSuffix(webURL, ".git") {
		return webURL
	}
	return webURL + ".git"
}
