package cnb

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

// Tree 实现 GitClienter 接口。
//
// GET /{repo}/-/git/contents/{file_path}?ref=... 当 file_path 为空时走 /{repo}/-/git/contents。
// 返回 Content{type=tree, entries=[...]}; CNB OpenAPI 不支持 recursive 参数,
// 调用方传 Recursive=true 时仅返回顶层(语义降级)。
func (c *Cnb) Tree(ctx context.Context, opts *domain.TreeOptions) (*domain.GetRepoTreeResp, error) {
	slug := repoSlug(opts.Owner, opts.Repo)
	if slug == "" {
		return nil, fmt.Errorf("cnb tree: missing repo slug")
	}

	path := "/" + slug + "/-/git/contents"
	if p := strings.Trim(opts.Path, "/"); p != "" {
		path += "/" + p
	}
	query := request.Query{}
	if opts.Ref != "" {
		query["ref"] = opts.Ref
	}

	content, err := request.Get[Content](c.client, ctx, path,
		request.WithHeader(c.authHeader(opts.Token)),
		request.WithQuery(query),
	)
	if err != nil {
		return nil, fmt.Errorf("get cnb tree: %w", err)
	}

	entries := []*domain.TreeEntry{}
	if content != nil {
		for _, e := range content.Entries {
			if e == nil {
				continue
			}
			entries = append(entries, &domain.TreeEntry{
				Mode: cnbTypeToMode(e.Type),
				Name: e.Name,
				Path: e.Path,
				Sha:  e.SHA,
				Size: int(e.Size),
			})
		}
	}
	return &domain.GetRepoTreeResp{
		Entries: entries,
		SHA:     opts.Ref,
	}, nil
}

// Blob 实现 GitClienter 接口。
//
// GET /{repo}/-/git/contents/{file_path}?ref=... 返回 Content{type=blob, content=base64}。
// LFS 对象 (type=lfs) 暂不解引用, 直接返回空内容并标记 IsBinary。
func (c *Cnb) Blob(ctx context.Context, opts *domain.BlobOptions) (*domain.GetBlobResp, error) {
	slug := repoSlug(opts.Owner, opts.Repo)
	if slug == "" {
		return nil, fmt.Errorf("cnb blob: missing repo slug")
	}
	if opts.Path == "" {
		return nil, fmt.Errorf("cnb blob: file path is required")
	}

	path := "/" + slug + "/-/git/contents/" + strings.TrimLeft(opts.Path, "/")
	query := request.Query{}
	if opts.Ref != "" {
		query["ref"] = opts.Ref
	}

	content, err := request.Get[Content](c.client, ctx, path,
		request.WithHeader(c.authHeader(opts.Token)),
		request.WithQuery(query),
	)
	if err != nil {
		return nil, fmt.Errorf("get cnb blob: %w", err)
	}
	if content == nil {
		return &domain.GetBlobResp{}, nil
	}

	var body []byte
	switch strings.ToLower(content.Type) {
	case "blob":
		if strings.EqualFold(content.Encoding, "base64") {
			cleaned := strings.ReplaceAll(content.Content, "\n", "")
			decoded, decErr := base64.StdEncoding.DecodeString(cleaned)
			if decErr != nil {
				return nil, fmt.Errorf("decode cnb blob base64: %w", decErr)
			}
			body = decoded
		} else {
			body = []byte(content.Content)
		}
	case "lfs":
		// LFS 对象暂不下载, 返回空; 大小取 lfs_size
		return &domain.GetBlobResp{
			Sha:      content.SHA,
			Size:     int(content.LFSSize),
			IsBinary: true,
		}, nil
	default:
		// tree / empty: 给个空响应
		return &domain.GetBlobResp{
			Sha:  content.SHA,
			Size: int(content.Size),
		}, nil
	}

	return &domain.GetBlobResp{
		Content:  body,
		IsBinary: isBinaryContent(body),
		Sha:      content.SHA,
		Size:     int(content.Size),
	}, nil
}

// Logs 实现 GitClienter 接口。
//
// GET /{repo}/-/git/commits?sha=&page=&page_size=
func (c *Cnb) Logs(ctx context.Context, opts *domain.LogsOptions) (*domain.GetGitLogsResp, error) {
	slug := repoSlug(opts.Owner, opts.Repo)
	if slug == "" {
		return nil, fmt.Errorf("cnb logs: missing repo slug")
	}

	limit := opts.Limit
	if limit <= 0 {
		limit = 100
	}
	page := (opts.Offset / limit) + 1

	query := request.Query{
		"page":      fmt.Sprintf("%d", page),
		"page_size": fmt.Sprintf("%d", limit),
	}
	if opts.Ref != "" {
		query["sha"] = opts.Ref
	}
	if opts.Path != "" {
		query["path"] = opts.Path
	}

	apiPath := "/" + slug + "/-/git/commits"
	commits, err := request.Get[[]*Commit](c.client, ctx, apiPath,
		request.WithHeader(c.authHeader(opts.Token)),
		request.WithQuery(query),
	)
	if err != nil {
		return nil, fmt.Errorf("list cnb commits: %w", err)
	}

	list := []*Commit{}
	if commits != nil {
		list = *commits
	}
	skip := opts.Offset % limit
	if skip > 0 {
		if skip >= len(list) {
			list = nil
		} else {
			list = list[skip:]
		}
	}

	entries := make([]*domain.GitCommitEntry, 0, len(list))
	for _, c := range list {
		if c == nil {
			continue
		}
		entry := &domain.GitCommitEntry{Commit: &domain.GitCommit{
			Sha: c.SHA,
		}}
		if c.Commit != nil {
			entry.Commit.Message = c.Commit.Message
			if c.Commit.Tree != nil {
				entry.Commit.TreeSha = c.Commit.Tree.SHA
			}
			if c.Commit.Author != nil {
				entry.Commit.Author = &domain.GitUser{
					Name:  c.Commit.Author.Name,
					Email: c.Commit.Author.Email,
					When:  parseCnbTime(c.Commit.Author.Date),
				}
			}
			if c.Commit.Committer != nil {
				entry.Commit.Committer = &domain.GitUser{
					Name:  c.Commit.Committer.Name,
					Email: c.Commit.Committer.Email,
					When:  parseCnbTime(c.Commit.Committer.Date),
				}
			}
		}
		if entry.Commit.Author == nil && c.Author != nil {
			entry.Commit.Author = &domain.GitUser{
				Name:  c.Author.Name,
				Email: c.Author.Email,
				When:  parseCnbTime(c.Author.Date),
			}
		}
		if entry.Commit.Committer == nil && c.Committer != nil {
			entry.Commit.Committer = &domain.GitUser{
				Name:  c.Committer.Name,
				Email: c.Committer.Email,
				When:  parseCnbTime(c.Committer.Date),
			}
		}
		for _, p := range c.Parents {
			if p != nil {
				entry.Commit.ParentShas = append(entry.Commit.ParentShas, p.SHA)
			}
		}
		entries = append(entries, entry)
	}
	return &domain.GetGitLogsResp{
		Count:   len(entries),
		Entries: entries,
	}, nil
}

// Archive 实现 GitClienter 接口。
//
// GET /{repo}/-/git/archive/{ref_with_path} 直接流式返回归档。
func (c *Cnb) Archive(ctx context.Context, opts *domain.ArchiveOptions) (*domain.GetRepoArchiveResp, error) {
	slug := repoSlug(opts.Owner, opts.Repo)
	if slug == "" {
		return nil, fmt.Errorf("cnb archive: missing repo slug")
	}
	ref := opts.Ref
	if ref == "" {
		ref = "main"
	}
	fullURL := c.BaseURL() + "/" + slug + "/-/git/archive/" + ref
	resp, err := c.rawRequest(ctx, "GET", fullURL, opts.Token)
	if err != nil {
		return nil, fmt.Errorf("download cnb archive: %w", err)
	}
	return &domain.GetRepoArchiveResp{
		ContentLength: resp.ContentLength,
		ContentType:   resp.Header.Get("Content-Type"),
		Reader:        resp.Body,
	}, nil
}

// Branches 实现 GitClienter 接口。
//
// GET /{repo}/-/git/branches?page=&page_size=
func (c *Cnb) Branches(ctx context.Context, opts *domain.BranchesOptions) ([]*domain.BranchInfo, error) {
	slug := repoSlug(opts.Owner, opts.Repo)
	if slug == "" {
		return nil, fmt.Errorf("cnb branches: missing repo slug")
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
		"page":      fmt.Sprintf("%d", page),
		"page_size": fmt.Sprintf("%d", perPage),
	}
	apiPath := "/" + slug + "/-/git/branches"
	branches, err := request.Get[[]*Branch](c.client, ctx, apiPath,
		request.WithHeader(c.authHeader(opts.Token)),
		request.WithQuery(query),
	)
	if err != nil {
		return nil, fmt.Errorf("list cnb branches: %w", err)
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
// CNB OpenAPI 暂未提供 webhook 管理接口, 「自动 review」对 CNB 不可用。
// 调用方应在 buildAutoWebhookOpt 阶段直接拒绝 cnb 平台, 这里仅作为接口契约的兜底。
func (c *Cnb) CreateWebhook(ctx context.Context, opts *domain.CreateWebhookOptions) error {
	return fmt.Errorf("cnb webhook: not supported")
}

// DeleteWebhook 实现 GitClienter 接口。
//
// 同 CreateWebhook, no-op 返回 nil 让"解绑"动作不至于失败。
func (c *Cnb) DeleteWebhook(ctx context.Context, opts *domain.WebhookOptions) error {
	return nil
}

func cnbTypeToMode(t string) int {
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

func parseCnbTime(s string) int64 {
	if s == "" {
		return 0
	}
	layouts := []string{
		time.RFC3339,
		time.RFC3339Nano,
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04:05+08:00",
		"2006-01-02 15:04:05",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Unix()
		}
	}
	return 0
}
