package atomgit

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

// Tree 实现 GitClienter 接口。
//
// GET /api/v5/repos/{owner}/{repo}/git/trees/{sha} 返回 sha 所指 tree 的子项数组
// (Gitee 风格, 路径里多一段 `/git/`)。{sha} 可以是分支名或 commit sha。
// 调用方传 Recursive=true 时透传 ?recursive=1。
//
// 兼容两种响应形态:
//   - 数组形态: 顶层直接是 [TreeNode]
//   - 对象形态: {sha, tree: [TreeNode]}
func (a *Atomgit) Tree(ctx context.Context, opts *domain.TreeOptions) (*domain.GetRepoTreeResp, error) {
	owner, repo := opts.Owner, opts.Repo
	if owner == "" || repo == "" {
		return nil, fmt.Errorf("atomgit tree: missing owner/repo")
	}
	ref := opts.Ref
	if ref == "" {
		ref = "HEAD"
	}

	path := APIPrefix + "/repos/" + url.PathEscape(owner) + "/" + url.PathEscape(repo) + "/git/trees/" + url.PathEscape(ref)
	query := request.Query{}
	if opts.Recursive {
		query["recursive"] = "1"
	}

	body, err := a.rawJSONGet(ctx, path, opts.Token, query)
	if err != nil {
		return nil, fmt.Errorf("get atomgit tree: %w", err)
	}

	nodes := decodeTreeNodes(body)
	entries := make([]*domain.TreeEntry, 0, len(nodes))
	prefix := strings.Trim(opts.Path, "/")
	for _, n := range nodes {
		if n == nil {
			continue
		}
		// Path 过滤: 仅当传入了 opts.Path 时, 保留前缀匹配的子项。
		if prefix != "" {
			if !strings.HasPrefix(n.Path, prefix+"/") && n.Path != prefix {
				continue
			}
		}
		entries = append(entries, &domain.TreeEntry{
			Mode: atomgitTypeToMode(n.Type),
			Name: leafName(n.Path),
			Path: n.Path,
			Sha:  n.SHA,
			Size: int(n.Size),
		})
	}
	return &domain.GetRepoTreeResp{
		Entries: entries,
		SHA:     ref,
	}, nil
}

// decodeTreeNodes 兼容数组形态与 {tree:[]} 对象形态。
func decodeTreeNodes(body []byte) []*TreeNode {
	body = bytes.TrimSpace(body)
	if len(body) == 0 {
		return nil
	}
	if body[0] == '[' {
		var arr []*TreeNode
		if err := json.Unmarshal(body, &arr); err == nil {
			return arr
		}
		return nil
	}
	var obj TreeResp
	if err := json.Unmarshal(body, &obj); err == nil {
		return obj.Tree
	}
	return nil
}

// Blob 实现 GitClienter 接口。
//
// GET /api/v5/repos/{owner}/{repo}/contents/{path}?ref=... 返回 Content{type=file, content=base64}。
// 对 type=dir / symlink / submodule 给出空响应; type=file 时按 encoding 解码。
func (a *Atomgit) Blob(ctx context.Context, opts *domain.BlobOptions) (*domain.GetBlobResp, error) {
	owner, repo := opts.Owner, opts.Repo
	if owner == "" || repo == "" {
		return nil, fmt.Errorf("atomgit blob: missing owner/repo")
	}
	if opts.Path == "" {
		return nil, fmt.Errorf("atomgit blob: file path is required")
	}

	// contents/{path} 的 path 段保留 `/` 分隔,但每一段都要 URL-encode。
	apiPath := APIPrefix + "/repos/" + owner + "/" + repo + "/contents/" + encodeFilePath(opts.Path)
	query := request.Query{}
	if opts.Ref != "" {
		query["ref"] = opts.Ref
	}

	content, err := request.Get[Content](a.client, ctx, apiPath,
		request.WithHeader(a.authHeader(opts.Token)),
		request.WithQuery(query),
	)
	if err != nil {
		return nil, fmt.Errorf("get atomgit blob: %w", err)
	}
	if content == nil {
		return &domain.GetBlobResp{}, nil
	}

	switch strings.ToLower(content.Type) {
	case "file":
		var body []byte
		if strings.EqualFold(content.Encoding, "base64") {
			cleaned := strings.ReplaceAll(content.Content, "\n", "")
			decoded, decErr := base64.StdEncoding.DecodeString(cleaned)
			if decErr != nil {
				return nil, fmt.Errorf("decode atomgit blob base64: %w", decErr)
			}
			body = decoded
		} else {
			body = []byte(content.Content)
		}
		return &domain.GetBlobResp{
			Content:  body,
			IsBinary: isBinaryContent(body),
			Sha:      content.SHA,
			Size:     int(content.Size),
		}, nil
	default:
		// dir / symlink / submodule 不返回内容
		return &domain.GetBlobResp{
			Sha:  content.SHA,
			Size: int(content.Size),
		}, nil
	}
}

// Logs 实现 GitClienter 接口。
//
// atomgit OpenAPI 暂未提供「commit 列表」入口 (仅有 GET /repos/:o/:r/commits/{ref} 拿单条),
// 这里返回未实现错误。当前业务调用方 (project tree/logs) 已无前端入口, 不影响功能。
func (a *Atomgit) Logs(ctx context.Context, opts *domain.LogsOptions) (*domain.GetGitLogsResp, error) {
	return nil, fmt.Errorf("atomgit logs: not supported")
}

// Archive 实现 GitClienter 接口。
//
// atomgit OpenAPI 暂未提供仓库归档下载入口, 返回未实现错误。
func (a *Atomgit) Archive(ctx context.Context, opts *domain.ArchiveOptions) (*domain.GetRepoArchiveResp, error) {
	return nil, fmt.Errorf("atomgit archive: not supported")
}

// Branches 实现 GitClienter 接口。
//
// GET /api/v5/repos/{owner}/{repo}/branches?page=&per_page=
func (a *Atomgit) Branches(ctx context.Context, opts *domain.BranchesOptions) ([]*domain.BranchInfo, error) {
	owner, repo := opts.Owner, opts.Repo
	if owner == "" || repo == "" {
		return nil, fmt.Errorf("atomgit branches: missing owner/repo")
	}

	page := opts.Page
	if page <= 0 {
		page = 1
	}
	perPage := opts.PerPage
	if perPage <= 0 {
		perPage = 50
	}
	if perPage > 100 {
		perPage = 100
	}

	query := request.Query{
		"page":     fmt.Sprintf("%d", page),
		"per_page": fmt.Sprintf("%d", perPage),
	}
	apiPath := APIPrefix + "/repos/" + owner + "/" + repo + "/branches"
	branches, err := request.Get[[]*Branch](a.client, ctx, apiPath,
		request.WithHeader(a.authHeader(opts.Token)),
		request.WithQuery(query),
	)
	if err != nil {
		return nil, fmt.Errorf("list atomgit branches: %w", err)
	}

	result := []*domain.BranchInfo{}
	if branches != nil {
		for _, b := range *branches {
			if b == nil {
				continue
			}
			result = append(result, &domain.BranchInfo{Name: b.Name})
		}
	}
	return result, nil
}

// CreateWebhook 实现 GitClienter 接口。
//
// atomgit OpenAPI 暂未提供 webhook 管理接口, 自动 review 暂不可用 (需用户在仓库设置页手工配置)。
// 同 CNB 的处理方式: Create 返回未实现错误, Delete 走 no-op 让"解绑"动作不至于失败。
func (a *Atomgit) CreateWebhook(ctx context.Context, opts *domain.CreateWebhookOptions) error {
	return fmt.Errorf("atomgit webhook: not supported")
}

// DeleteWebhook 实现 GitClienter 接口。
func (a *Atomgit) DeleteWebhook(ctx context.Context, opts *domain.WebhookOptions) error {
	return nil
}

// rawJSONGet 透传 JSON GET, 用于 Tree 这种需要按字节判断响应形态的场景。
func (a *Atomgit) rawJSONGet(ctx context.Context, apiPath, token string, query request.Query) ([]byte, error) {
	fullURL := a.BaseURL() + apiPath
	if len(query) > 0 {
		vals := url.Values{}
		for k, v := range query {
			vals.Set(k, v)
		}
		fullURL += "?" + vals.Encode()
	}
	resp, err := a.rawRequest(ctx, "GET", fullURL, token)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

// encodeFilePath 将文件路径每段 URL-encode,但保留 `/` 分隔符 (atomgit contents 走层级 path)。
func encodeFilePath(p string) string {
	p = strings.TrimLeft(p, "/")
	segs := strings.Split(p, "/")
	for i, s := range segs {
		segs[i] = url.PathEscape(s)
	}
	return strings.Join(segs, "/")
}

func atomgitTypeToMode(t string) int {
	switch strings.ToLower(t) {
	case "tree", "dir", "directory":
		return 4
	default:
		return 1
	}
}

func isBinaryContent(content []byte) bool {
	if len(content) == 0 {
		return false
	}
	check := content
	if len(check) > 8000 {
		check = check[:8000]
	}
	return bytes.Contains(check, []byte{0})
}

func leafName(p string) string {
	p = strings.TrimRight(p, "/")
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}
