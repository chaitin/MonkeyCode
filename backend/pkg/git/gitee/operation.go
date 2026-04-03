package gitee

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

// giteeAuthOpts 根据 isOAuth 返回认证相关的请求选项和 query 参数
func giteeAuthOpts(token string, isOAuth bool, query map[string]string) []request.Opt {
	if isOAuth {
		query["access_token"] = token
		return nil
	}
	return []request.Opt{request.WithHeader(request.Header{"Authorization": "token " + token})}
}

// GetRepoDescription 获取仓库描述
func (g *Gitee) GetRepoDescription(ctx context.Context, token, repoURL string, isOAuth bool) (string, error) {
	owner, repo, err := parseGiteeRepoPath(repoURL)
	if err != nil {
		return "", err
	}
	path := fmt.Sprintf("/api/v5/repos/%s/%s", owner, repo)
	query := map[string]string{}
	client := g.newRequestClientForToken(token)
	opts := []request.Opt{request.WithQuery(query)}
	opts = append(opts, giteeAuthOpts(token, isOAuth, query)...)
	repoInfo, err := request.Get[Repository](client, ctx, path, opts...)
	if err != nil {
		return "", fmt.Errorf("get repo: %w", err)
	}
	return repoInfo.Description, nil
}

// GetRepoTree 获取仓库文件树
func (g *Gitee) GetRepoTree(ctx context.Context, token, owner, repo, ref, treePath string, recursive, isOAuth bool) (*GetRepoTreeResp, error) {
	if ref == "" {
		ref = "master"
	}
	client := g.newRequestClientForToken(token)
	apiPath := fmt.Sprintf("/api/v5/repos/%s/%s/git/trees/%s", owner, repo, url.PathEscape(ref))
	query := map[string]string{}
	if recursive || treePath != "" {
		query["recursive"] = "1"
	}

	type giteeTreeNode struct {
		Path string `json:"path"`
		Mode string `json:"mode"`
		Type string `json:"type"`
		Sha  string `json:"sha"`
		Size int    `json:"size"`
	}
	type giteeTreeResp struct {
		Sha  string           `json:"sha"`
		Tree []*giteeTreeNode `json:"tree"`
	}

	opts := []request.Opt{request.WithQuery(query)}
	opts = append(opts, giteeAuthOpts(token, isOAuth, query)...)
	treeResp, err := request.Get[giteeTreeResp](client, ctx, apiPath, opts...)
	if err != nil {
		return nil, fmt.Errorf("get tree: %w", err)
	}

	prefix := ""
	if treePath != "" {
		prefix = strings.TrimSuffix(treePath, "/") + "/"
	}

	entries := make([]*TreeEntry, 0, len(treeResp.Tree))
	for _, node := range treeResp.Tree {
		entryPath := node.Path
		if prefix != "" && !strings.HasPrefix(entryPath, prefix) {
			continue
		}
		if prefix != "" && !recursive {
			rel := strings.TrimPrefix(entryPath, prefix)
			if rel == "" || strings.Contains(rel, "/") {
				continue
			}
		}
		mode := giteeTypeToMode(node.Type)
		name := baseName(entryPath)
		entries = append(entries, &TreeEntry{
			Mode: mode,
			Name: name,
			Path: entryPath,
			Sha:  node.Sha,
			Size: node.Size,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Path < entries[j].Path
	})
	return &GetRepoTreeResp{
		Entries: entries,
		SHA:     treeResp.Sha,
	}, nil
}

// GetBlob 获取单文件内容
func (g *Gitee) GetBlob(ctx context.Context, token, owner, repo, ref, path string, isOAuth bool) (*GetBlobResp, error) {
	client := g.newRequestClientForToken(token)
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	escapedPath := strings.Join(parts, "/")
	apiPath := fmt.Sprintf("/api/v5/repos/%s/%s/contents/%s", owner, repo, escapedPath)
	query := map[string]string{}
	if ref != "" {
		query["ref"] = ref
	}

	type giteeContentResp struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
		Sha      string `json:"sha"`
		Size     int    `json:"size"`
	}

	opts := []request.Opt{request.WithQuery(query)}
	opts = append(opts, giteeAuthOpts(token, isOAuth, query)...)
	contentResp, err := request.Get[giteeContentResp](client, ctx, apiPath, opts...)
	if err != nil {
		return nil, fmt.Errorf("get file content: %w", err)
	}

	var content []byte
	if contentResp.Encoding == "base64" {
		cleaned := strings.ReplaceAll(contentResp.Content, "\n", "")
		content, err = base64.StdEncoding.DecodeString(cleaned)
		if err != nil {
			return nil, fmt.Errorf("decode content: %w", err)
		}
	} else {
		content = []byte(contentResp.Content)
	}
	return &GetBlobResp{
		Content:  content,
		IsBinary: isBinaryContent(content),
		Sha:      contentResp.Sha,
		Size:     contentResp.Size,
	}, nil
}

// GetGitLogs 获取提交历史
func (g *Gitee) GetGitLogs(ctx context.Context, token, owner, repo, ref, path string, limit, offset int, isOAuth bool) (*GetGitLogsResp, error) {
	client := g.newRequestClientForToken(token)
	if limit <= 0 {
		limit = 100
	}
	page := (offset / limit) + 1
	apiPath := fmt.Sprintf("/api/v5/repos/%s/%s/commits", owner, repo)
	query := map[string]string{
		"page":     fmt.Sprintf("%d", page),
		"per_page": fmt.Sprintf("%d", limit),
	}
	if ref != "" {
		query["sha"] = ref
	}
	if path != "" {
		query["path"] = path
	}

	type giteeCommitUser struct {
		Name  string `json:"name"`
		Email string `json:"email"`
		Date  string `json:"date"`
	}
	type giteeCommitDetail struct {
		Author    *giteeCommitUser `json:"author"`
		Committer *giteeCommitUser `json:"committer"`
		Message   string           `json:"message"`
		Tree      struct {
			Sha string `json:"sha"`
		} `json:"tree"`
	}
	type giteeCommitParent struct {
		Sha string `json:"sha"`
	}
	type giteeCommitResp struct {
		Sha     string               `json:"sha"`
		Commit  *giteeCommitDetail   `json:"commit"`
		Parents []*giteeCommitParent `json:"parents"`
	}

	opts := []request.Opt{request.WithQuery(query)}
	opts = append(opts, giteeAuthOpts(token, isOAuth, query)...)
	commits, err := request.Get[[]giteeCommitResp](client, ctx, apiPath, opts...)
	if err != nil {
		return nil, fmt.Errorf("list commits: %w", err)
	}

	pagedCommits := *commits
	skip := offset % limit
	if skip > 0 {
		if skip >= len(pagedCommits) {
			pagedCommits = nil
		} else {
			pagedCommits = pagedCommits[skip:]
		}
	}

	entries := make([]*GitCommitEntry, 0, len(pagedCommits))
	for _, c := range pagedCommits {
		entry := &GitCommitEntry{
			Commit: &GitCommit{
				Sha:        c.Sha,
				Message:    c.Commit.Message,
				TreeSha:    c.Commit.Tree.Sha,
				ParentShas: make([]string, 0, len(c.Parents)),
			},
		}
		if c.Commit.Author != nil {
			entry.Commit.Author = &GitUser{
				Name:  c.Commit.Author.Name,
				Email: c.Commit.Author.Email,
				When:  parseGiteeDate(c.Commit.Author.Date),
			}
		}
		if c.Commit.Committer != nil {
			entry.Commit.Committer = &GitUser{
				Name:  c.Commit.Committer.Name,
				Email: c.Commit.Committer.Email,
				When:  parseGiteeDate(c.Commit.Committer.Date),
			}
		}
		for _, p := range c.Parents {
			entry.Commit.ParentShas = append(entry.Commit.ParentShas, p.Sha)
		}
		entries = append(entries, entry)
	}
	return &GetGitLogsResp{
		Count:   len(entries),
		Entries: entries,
	}, nil
}

// GetRepoArchive 获取仓库压缩包
func (g *Gitee) GetRepoArchive(ctx context.Context, token, owner, repo, ref string, isOAuth bool) (*GetRepoArchiveResp, error) {
	if ref == "" {
		ref = "master"
	}
	base := strings.TrimSuffix(g.baseURL, "/")
	apiURL := fmt.Sprintf("%s/api/v5/repos/%s/%s/tarball?ref=%s",
		base, owner, repo, url.QueryEscape(ref))
	if isOAuth {
		apiURL += "&access_token=" + url.QueryEscape(token)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	if !isOAuth {
		req.Header.Set("Authorization", "token "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get archive: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("get archive failed with status %d: %s", resp.StatusCode, string(body))
	}
	return &GetRepoArchiveResp{
		ContentLength: resp.ContentLength,
		ContentType:   "application/gzip",
		Reader:        resp.Body,
	}, nil
}

// ListBranches 获取 Gitee 仓库分支列表
func ListBranches(ctx context.Context, token, owner, repo string, page, perPage int, isOAuth bool) ([]*BranchInfo, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	apiURL := fmt.Sprintf("https://gitee.com/api/v5/repos/%s/%s/branches?page=%d&per_page=%d",
		url.PathEscape(owner), url.PathEscape(repo), page, perPage)
	if isOAuth {
		apiURL += "&access_token=" + url.QueryEscape(token)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	if !isOAuth {
		req.Header.Set("Authorization", "token "+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request gitee branches api: %w", err)
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gitee branches api returned status %d: %s", resp.StatusCode, string(body))
	}
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}

	type giteeBranch struct {
		Name string `json:"name"`
	}
	var branches []giteeBranch
	if err := json.Unmarshal(body, &branches); err != nil {
		return nil, fmt.Errorf("unmarshal branches: %w", err)
	}
	result := make([]*BranchInfo, 0, len(branches))
	for _, b := range branches {
		result = append(result, &BranchInfo{Name: b.Name})
	}
	return result, nil
}

func giteeTypeToMode(entryType string) int {
	switch entryType {
	case "tree":
		return 4
	case "blob":
		return 1
	default:
		return 1
	}
}

func baseName(path string) string {
	if i := strings.LastIndex(path, "/"); i >= 0 {
		return path[i+1:]
	}
	return path
}

func parseGiteeDate(dateStr string) int64 {
	if dateStr == "" {
		return 0
	}
	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04:05+08:00",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, dateStr); err == nil {
			return t.Unix()
		}
	}
	return 0
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

// UserInfo 实现 GitPlatformClient 接口
func (g *Gitee) UserInfo(ctx context.Context, token string) (*domain.PlatformUserInfo, error) {
	return g.GetUserInfoByPAT(ctx, token)
}

// Repositories 实现 GitPlatformClient 接口
func (g *Gitee) Repositories(ctx context.Context, opts *domain.RepositoryOptions) ([]domain.AuthRepository, error) {
	repos, err := g.ListUserReposByToken(g.baseURL, opts.Token, 1, 100)
	if err != nil {
		return nil, err
	}
	result := make([]domain.AuthRepository, len(repos))
	for i, r := range repos {
		result[i] = domain.AuthRepository{FullName: r.FullName, URL: r.HTMLURL, Description: r.Description}
	}
	return result, nil
}

// Tree 实现 GitPlatformClient 接口
func (g *Gitee) Tree(ctx context.Context, opts *domain.TreeOptions) (*domain.GetRepoTreeResp, error) {
	resp, err := g.GetRepoTree(ctx, opts.Token, opts.Owner, opts.Repo, opts.Ref, opts.Path, opts.Recursive, opts.IsOAuth)
	if err != nil {
		return nil, err
	}
	entries := make([]*domain.TreeEntry, len(resp.Entries))
	for i, e := range resp.Entries {
		entries[i] = &domain.TreeEntry{Mode: e.Mode, Name: e.Name, Path: e.Path, Sha: e.Sha, Size: e.Size}
	}
	return &domain.GetRepoTreeResp{Entries: entries, SHA: resp.SHA}, nil
}

// Blob 实现 GitPlatformClient 接口
func (g *Gitee) Blob(ctx context.Context, opts *domain.BlobOptions) (*domain.GetBlobResp, error) {
	resp, err := g.GetBlob(ctx, opts.Token, opts.Owner, opts.Repo, opts.Ref, opts.Path, opts.IsOAuth)
	if err != nil {
		return nil, err
	}
	return &domain.GetBlobResp{Content: resp.Content, IsBinary: resp.IsBinary, Sha: resp.Sha, Size: resp.Size}, nil
}

// Logs 实现 GitPlatformClient 接口
func (g *Gitee) Logs(ctx context.Context, opts *domain.LogsOptions) (*domain.GetGitLogsResp, error) {
	resp, err := g.GetGitLogs(ctx, opts.Token, opts.Owner, opts.Repo, opts.Ref, opts.Path, opts.Limit, opts.Offset, opts.IsOAuth)
	if err != nil {
		return nil, err
	}
	entries := make([]*domain.GitCommitEntry, len(resp.Entries))
	for i, e := range resp.Entries {
		entries[i] = &domain.GitCommitEntry{
			Commit: &domain.GitCommit{
				Author:     &domain.GitUser{Email: e.Commit.Author.Email, Name: e.Commit.Author.Name, When: e.Commit.Author.When},
				Committer:  &domain.GitUser{Email: e.Commit.Committer.Email, Name: e.Commit.Committer.Name, When: e.Commit.Committer.When},
				Message:    e.Commit.Message,
				ParentShas: e.Commit.ParentShas,
				Sha:        e.Commit.Sha,
				TreeSha:    e.Commit.TreeSha,
			},
		}
	}
	return &domain.GetGitLogsResp{Count: resp.Count, Entries: entries}, nil
}

// Archive 实现 GitPlatformClient 接口
func (g *Gitee) Archive(ctx context.Context, opts *domain.ArchiveOptions) (*domain.GetRepoArchiveResp, error) {
	resp, err := g.GetRepoArchive(ctx, opts.Token, opts.Owner, opts.Repo, opts.Ref, opts.IsOAuth)
	if err != nil {
		return nil, err
	}
	return &domain.GetRepoArchiveResp{ContentLength: resp.ContentLength, ContentType: resp.ContentType, Reader: resp.Reader}, nil
}

// Branches 实现 GitPlatformClient 接口
func (g *Gitee) Branches(ctx context.Context, opts *domain.BranchesOptions) ([]*domain.BranchInfo, error) {
	resp, err := ListBranches(ctx, opts.Token, opts.Owner, opts.Repo, opts.Page, opts.PerPage, opts.IsOAuth)
	if err != nil {
		return nil, err
	}
	result := make([]*domain.BranchInfo, 0, len(resp))
	for _, b := range resp {
		result = append(result, &domain.BranchInfo{Name: b.Name})
	}
	return result, nil
}

// DeleteWebhook 实现 GitPlatformClient 接口
func (g *Gitee) DeleteWebhook(ctx context.Context, opts *domain.WebhookOptions) error {
	owner, repo, err := parseGiteeRepoPath(opts.RepoURL)
	if err != nil {
		return err
	}

	client := &http.Client{Timeout: 30 * time.Second}

	// 分页查找匹配的 webhook
	for page := 1; ; page++ {
		apiURL := fmt.Sprintf("https://gitee.com/api/v5/repos/%s/%s/hooks?page=%d&per_page=100",
			url.PathEscape(owner), url.PathEscape(repo), page)
		if opts.IsOAuth {
			apiURL += "&access_token=" + url.QueryEscape(opts.Token)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
		if err != nil {
			return fmt.Errorf("create request: %w", err)
		}
		if !opts.IsOAuth {
			req.Header.Set("Authorization", "token "+opts.Token)
		}
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("list hooks: %w", err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("list hooks returned status %d: %s", resp.StatusCode, string(body))
		}

		var hooks []struct {
			ID  int64  `json:"id"`
			URL string `json:"url"`
		}
		if err := json.Unmarshal(body, &hooks); err != nil {
			return fmt.Errorf("unmarshal hooks: %w", err)
		}
		if len(hooks) == 0 {
			break
		}
		for _, hook := range hooks {
			if hook.URL == opts.WebhookURL {
				deleteURL := fmt.Sprintf("https://gitee.com/api/v5/repos/%s/%s/hooks/%d",
					url.PathEscape(owner), url.PathEscape(repo), hook.ID)
				if opts.IsOAuth {
					deleteURL += "?access_token=" + url.QueryEscape(opts.Token)
				}
				delReq, err := http.NewRequestWithContext(ctx, http.MethodDelete, deleteURL, nil)
				if err != nil {
					return fmt.Errorf("create delete request: %w", err)
				}
				if !opts.IsOAuth {
					delReq.Header.Set("Authorization", "token "+opts.Token)
				}
				delResp, err := client.Do(delReq)
				if err != nil {
					return fmt.Errorf("delete hook %d: %w", hook.ID, err)
				}
				delResp.Body.Close()
				if delResp.StatusCode != http.StatusOK && delResp.StatusCode != http.StatusNoContent {
					return fmt.Errorf("delete hook %d returned status %d", hook.ID, delResp.StatusCode)
				}
				return nil
			}
		}
	}
	return nil
}

// CreateWebhook 实现 GitPlatformClient 接口
func (g *Gitee) CreateWebhook(ctx context.Context, opts *domain.CreateWebhookOptions) error {
	owner, repo, err := parseGiteeRepoPath(opts.RepoURL)
	if err != nil {
		return err
	}

	client := &http.Client{Timeout: 30 * time.Second}
	apiURL := fmt.Sprintf("https://gitee.com/api/v5/repos/%s/%s/hooks",
		url.PathEscape(owner), url.PathEscape(repo))

	payload := map[string]any{
		"url":                   opts.WebhookURL,
		"password":              opts.SecretToken,
		"push_events":          true,
		"merge_requests_events": true,
		"note_events":          true,
	}
	if opts.IsOAuth {
		payload["access_token"] = opts.Token
	}

	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if !opts.IsOAuth {
		req.Header.Set("Authorization", "token "+opts.Token)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("create webhook: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("create webhook returned status %d: %s", resp.StatusCode, string(body))
	}
	return nil
}
