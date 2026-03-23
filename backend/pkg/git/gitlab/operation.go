package gitlab

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/url"
	"sort"
	"strings"

	gitlab "gitlab.com/gitlab-org/api/client-go"

	domainpkg "github.com/chaitin/MonkeyCode/backend/domain"
)

// ParseProjectPath 从仓库 URL 解析出项目路径（path_with_namespace）
func ParseProjectPath(repoURL string) (string, error) {
	u, err := url.Parse(repoURL)
	if err != nil {
		return "", fmt.Errorf("parse repo url: %w", err)
	}
	path := strings.Trim(u.Path, "/")
	path = strings.TrimSuffix(path, ".git")
	if path == "" {
		return "", fmt.Errorf("invalid repo url path: %s", repoURL)
	}
	path, _ = url.PathUnescape(path)
	return path, nil
}

func ptr[T any](v T) *T { return &v }

// GetRepoDescription 获取仓库描述
func (g *Gitlab) GetRepoDescription(ctx context.Context, token, repoURL string, isOAuth bool) (string, error) {
	projectPath, err := ParseProjectPath(repoURL)
	if err != nil {
		return "", err
	}
	client, err := g.newClientWithToken(token, isOAuth)
	if err != nil {
		return "", fmt.Errorf("new client: %w", err)
	}
	project, _, err := client.Projects.GetProject(projectPath, &gitlab.GetProjectOptions{})
	if err != nil {
		return "", fmt.Errorf("get project: %w", err)
	}
	return project.Description, nil
}

// GetAuthorizedRepositories 获取 token 可访问的仓库列表
func (g *Gitlab) GetAuthorizedRepositories(ctx context.Context, token string) ([]domainpkg.AuthRepository, error) {
	client, err := g.newClientWithToken(token, false)
	if err != nil {
		return nil, fmt.Errorf("new client: %w", err)
	}
	return g.listProjects(ctx, client)
}

func (g *Gitlab) listProjects(ctx context.Context, client *gitlab.Client) ([]domainpkg.AuthRepository, error) {
	opt := &gitlab.ListProjectsOptions{
		ListOptions: gitlab.ListOptions{PerPage: 100},
		Membership:  ptr(true),
	}
	var all []*gitlab.Project
	for {
		projects, resp, err := client.Projects.ListProjects(opt, gitlab.WithContext(ctx))
		if err != nil {
			return nil, fmt.Errorf("list projects: %w", err)
		}
		all = append(all, projects...)
		if resp.NextPage == 0 {
			break
		}
		opt.Page = resp.NextPage
	}
	out := make([]domainpkg.AuthRepository, 0, len(all))
	for _, p := range all {
		cloneURL := p.HTTPURLToRepo
		if cloneURL == "" {
			cloneURL = p.SSHURLToRepo
		}
		out = append(out, domainpkg.AuthRepository{
			FullName:    p.PathWithNamespace,
			URL:         cloneURL,
			Description: p.Description,
		})
	}
	return out, nil
}

// ListBranches 获取仓库分支列表
func (g *Gitlab) ListBranches(ctx context.Context, token, projectPath string, isOAuth bool, page, perPage int) ([]*BranchInfo, error) {
	client, err := g.newClientWithToken(token, isOAuth)
	if err != nil {
		return nil, fmt.Errorf("new client: %w", err)
	}
	opt := &gitlab.ListBranchesOptions{
		ListOptions: gitlab.ListOptions{Page: int64(page), PerPage: int64(perPage)},
	}
	branches, _, err := client.Branches.ListBranches(projectPath, opt, gitlab.WithContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("list branches: %w", err)
	}
	result := make([]*BranchInfo, 0, len(branches))
	for _, b := range branches {
		result = append(result, &BranchInfo{Name: b.Name})
	}
	return result, nil
}

// GetRepoTree 获取仓库文件树
func (g *Gitlab) GetRepoTree(ctx context.Context, token, projectPath, ref, path string, recursive bool, isOAuth bool) (*GetRepoTreeResp, error) {
	if ref == "" {
		ref = "HEAD"
	}
	client, err := g.newClientWithToken(token, isOAuth)
	if err != nil {
		return nil, fmt.Errorf("new client: %w", err)
	}
	opt := &gitlab.ListTreeOptions{
		ListOptions: gitlab.ListOptions{PerPage: 100},
		Ref:         ptr(ref),
		Recursive:   ptr(recursive),
	}
	if path != "" {
		opt.Path = ptr(path)
	}
	var tree []*gitlab.TreeNode
	for {
		page, resp, err := client.Repositories.ListTree(projectPath, opt, gitlab.WithContext(ctx))
		if err != nil {
			return nil, fmt.Errorf("list tree: %w", err)
		}
		tree = append(tree, page...)
		if resp.NextPage == 0 {
			break
		}
		opt.Page = resp.NextPage
	}
	prefix := ""
	if path != "" {
		prefix = strings.TrimSuffix(path, "/") + "/"
	}
	entries := make([]*TreeEntry, 0, len(tree))
	for _, e := range tree {
		entryPath := e.Path
		if prefix != "" && !strings.HasPrefix(entryPath, prefix) {
			continue
		}
		mode := gitlabModeToInt(e.Type, e.Mode)
		entries = append(entries, &TreeEntry{
			Mode: mode,
			Name: e.Name,
			Path: entryPath,
			Sha:  e.ID,
			Size: 0,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Path < entries[j].Path
	})
	return &GetRepoTreeResp{
		Entries: entries,
		SHA:     "",
	}, nil
}

func gitlabModeToInt(entryType, mode string) int {
	switch entryType {
	case "tree":
		return 4
	case "blob":
		return 1
	}
	if strings.HasPrefix(mode, "04") {
		return 4
	}
	return 1
}

// GetBlob 获取单文件内容
func (g *Gitlab) GetBlob(ctx context.Context, token, projectPath, ref, path string, isOAuth bool) (*GetBlobResp, error) {
	client, err := g.newClientWithToken(token, isOAuth)
	if err != nil {
		return nil, fmt.Errorf("new client: %w", err)
	}
	opt := &gitlab.GetFileOptions{}
	if ref != "" {
		opt.Ref = ptr(ref)
	}
	file, _, err := client.RepositoryFiles.GetFile(projectPath, path, opt, gitlab.WithContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("get file: %w", err)
	}
	var content []byte
	if file.Encoding == "base64" {
		content, err = base64.StdEncoding.DecodeString(file.Content)
		if err != nil {
			return nil, fmt.Errorf("decode content: %w", err)
		}
	} else {
		content = []byte(file.Content)
	}
	return &GetBlobResp{
		Content:  content,
		IsBinary: isBinaryContent(content),
		Sha:      file.BlobID,
		Size:     int(file.Size),
	}, nil
}

// GetGitLogs 获取提交历史
func (g *Gitlab) GetGitLogs(ctx context.Context, token, projectPath, ref, path string, limit, offset int, isOAuth bool) (*GetGitLogsResp, error) {
	client, err := g.newClientWithToken(token, isOAuth)
	if err != nil {
		return nil, fmt.Errorf("new client: %w", err)
	}
	if limit <= 0 {
		limit = 100
	}
	page := (offset / limit) + 1
	opt := &gitlab.ListCommitsOptions{
		ListOptions: gitlab.ListOptions{Page: int64(page), PerPage: int64(limit)},
	}
	if ref != "" {
		opt.RefName = ptr(ref)
	}
	if path != "" {
		opt.Path = ptr(path)
	}
	commits, _, err := client.Commits.ListCommits(projectPath, opt, gitlab.WithContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("list commits: %w", err)
	}
	entries := make([]*GitCommitEntry, 0, len(commits))
	for _, c := range commits {
		entry := &GitCommitEntry{
			Commit: &GitCommit{
				Sha:        c.ID,
				Message:    c.Message,
				TreeSha:    "",
				ParentShas: c.ParentIDs,
			},
		}
		if c.AuthoredDate != nil {
			entry.Commit.Author = &GitUser{
				Name:  c.AuthorName,
				Email: c.AuthorEmail,
				When:  c.AuthoredDate.Unix(),
			}
		}
		if c.CommittedDate != nil {
			entry.Commit.Committer = &GitUser{
				Name:  c.CommitterName,
				Email: c.CommitterEmail,
				When:  c.CommittedDate.Unix(),
			}
		}
		entries = append(entries, entry)
	}
	return &GetGitLogsResp{
		Count:   len(entries),
		Entries: entries,
	}, nil
}

// GetRepoArchive 获取仓库压缩包
func (g *Gitlab) GetRepoArchive(ctx context.Context, token, projectPath, ref string, isOAuth bool) (*GetRepoArchiveResp, error) {
	client, err := g.newClientWithToken(token, isOAuth)
	if err != nil {
		return nil, fmt.Errorf("new client: %w", err)
	}
	opt := &gitlab.ArchiveOptions{
		Format: ptr("tar.gz"),
	}
	if ref != "" {
		opt.SHA = ptr(ref)
	}
	pipeR, pipeW := io.Pipe()
	go func() {
		defer pipeW.Close()
		_, err := client.Repositories.StreamArchive(projectPath, pipeW, opt, gitlab.WithContext(ctx))
		if err != nil {
			_ = pipeW.CloseWithError(err)
		}
	}()
	return &GetRepoArchiveResp{
		ContentLength: -1,
		ContentType:   "application/gzip",
		Reader:        pipeR,
	}, nil
}

// DeleteWebhookByURL 根据 webhook URL 精确匹配删除 GitLab 项目上的 webhook
func (g *Gitlab) DeleteWebhookByURL(ctx context.Context, token, repoURL, webhookURL string, isOAuth bool) error {
	projectPath, err := ParseProjectPath(repoURL)
	if err != nil {
		return err
	}
	client, err := g.newClientWithToken(token, isOAuth)
	if err != nil {
		return fmt.Errorf("new client: %w", err)
	}
	opt := &gitlab.ListProjectHooksOptions{
		ListOptions: gitlab.ListOptions{PerPage: 100},
	}
	for {
		hooks, resp, err := client.Projects.ListProjectHooks(projectPath, opt, gitlab.WithContext(ctx))
		if err != nil {
			return fmt.Errorf("list project hooks: %w", err)
		}
		for _, hook := range hooks {
			if hook.URL == webhookURL {
				_, err := client.Projects.DeleteProjectHook(projectPath, hook.ID, gitlab.WithContext(ctx))
				if err != nil {
					return fmt.Errorf("delete project hook %d: %w", hook.ID, err)
				}
				return nil
			}
		}
		if resp.NextPage == 0 {
			break
		}
		opt.Page = resp.NextPage
	}
	return nil
}

// CreateProjectWebhook 在 GitLab 项目上注册 webhook
func (g *Gitlab) CreateProjectWebhook(ctx context.Context, token, repoURL, webhookURL, secretToken string, isOAuth bool) error {
	projectPath, err := ParseProjectPath(repoURL)
	if err != nil {
		return err
	}
	client, err := g.newClientWithToken(token, isOAuth)
	if err != nil {
		return fmt.Errorf("new client: %w", err)
	}
	_, _, err = client.Projects.AddProjectHook(projectPath, &gitlab.AddProjectHookOptions{
		URL:                   ptr(webhookURL),
		Token:                 ptr(secretToken),
		MergeRequestsEvents:   ptr(true),
		NoteEvents:            ptr(true),
		EnableSSLVerification: ptr(true),
	}, gitlab.WithContext(ctx))
	if err != nil {
		return fmt.Errorf("add project hook: %w", err)
	}
	return nil
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
