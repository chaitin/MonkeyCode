package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/go-github/v74/github"
)

// treeCommitInfoPath 为 GitHub 专属的「树+最近提交信息」接口
const treeCommitInfoPath = "repos/%s/%s/tree-commit-info/%s"

// GetRepoTree 获取仓库文件树（PAT 模式）
func (g *Github) GetRepoTree(ctx context.Context, token, owner, repo, ref, path string, recursive bool) (*GetRepoTreeResp, error) {
	if ref == "" {
		ref = "HEAD"
	}

	// 优先使用 GitHub 专属 tree-commit-info 接口
	if resp, err := g.getRepoTreeCommitInfo(ctx, token, owner, repo, ref, path, recursive); err == nil {
		return resp, nil
	}

	cli := newClientWithToken(ctx, token)

	// Non-recursive sub-path: use Contents API
	if path != "" && !recursive {
		_, dirContent, _, err := cli.Repositories.GetContents(ctx, owner, repo, path, &github.RepositoryContentGetOptions{Ref: ref})
		if err != nil {
			return nil, fmt.Errorf("get contents for path %s: %w", path, err)
		}
		resp := dirContentToTreeResp(dirContent, path)
		fillLastModifiedAt(ctx, cli, owner, repo, ref, path, resp.Entries)
		return resp, nil
	}

	tree, _, err := cli.Git.GetTree(ctx, owner, repo, ref, recursive)
	if err != nil {
		return nil, fmt.Errorf("get tree: %w", err)
	}

	prefix := ""
	if path != "" {
		prefix = strings.TrimSuffix(path, "/") + "/"
	}

	entries := make([]*TreeEntry, 0, len(tree.Entries))
	for _, e := range tree.Entries {
		entryPath := e.GetPath()
		if prefix != "" && !strings.HasPrefix(entryPath, prefix) {
			continue
		}
		mode := gitModeToInt(e.GetType(), "")
		entries = append(entries, &TreeEntry{
			Mode: mode,
			Name: baseName(entryPath),
			Path: entryPath,
			Sha:  e.GetSHA(),
			Size: e.GetSize(),
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Path < entries[j].Path
	})
	fillLastModifiedAt(ctx, cli, owner, repo, ref, path, entries)
	return &GetRepoTreeResp{
		Entries: entries,
		SHA:     tree.GetSHA(),
	}, nil
}

// fillLastModifiedAt 通过 Commits API 按路径查最近一次提交时间
func fillLastModifiedAt(ctx context.Context, cli *github.Client, owner, repo, ref, basePath string, entries []*TreeEntry) {
	const concurrency = 8
	type item struct {
		i    int
		path string
	}
	ch := make(chan item, len(entries))
	for i, e := range entries {
		ch <- item{i: i, path: e.Path}
	}
	close(ch)
	unix := make([]int64, len(entries))
	var wg sync.WaitGroup
	for range concurrency {
		wg.Go(func() {
			for it := range ch {
				opts := &github.CommitsListOptions{
					SHA:         ref,
					ListOptions: github.ListOptions{PerPage: 1},
				}
				opts.Path = it.path
				commits, _, err := cli.Repositories.ListCommits(ctx, owner, repo, opts)
				if err != nil || len(commits) == 0 {
					continue
				}
				if c := commits[0].GetCommit(); c != nil && c.GetCommitter() != nil {
					unix[it.i] = c.GetCommitter().GetDate().Unix()
				}
			}
		})
	}
	wg.Wait()
	for i, t := range unix {
		entries[i].LastModifiedAt = t
	}
}

// treeCommitInfoEntryRaw tree-commit-info 接口条目的原始结构
type treeCommitInfoEntryRaw struct {
	Mode           int    `json:"mode"`
	Name           string `json:"name"`
	Path           string `json:"path"`
	Sha            string `json:"sha"`
	Size           int    `json:"size"`
	LastModifiedAt int64  `json:"last_modified_at"`
	Date           string `json:"date"`
	Commit         *struct {
		Committer *struct {
			Date *string `json:"date"`
		} `json:"committer"`
		Author *struct {
			Date *string `json:"date"`
		} `json:"author"`
	} `json:"commit"`
}

// getRepoTreeCommitInfo 调用 GitHub tree-commit-info 接口
func (g *Github) getRepoTreeCommitInfo(ctx context.Context, token, owner, repo, ref, path string, recursive bool) (*GetRepoTreeResp, error) {
	refEscaped := url.PathEscape(ref)
	apiPath := fmt.Sprintf(treeCommitInfoPath, owner, repo, refEscaped)
	baseURL := "https://api.github.com/"
	u, err := url.Parse(baseURL + apiPath)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	if path != "" {
		q.Set("path", path)
	}
	if recursive {
		q.Set("recursive", "true")
	}
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tree-commit-info status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var raw struct {
		SHA     string                    `json:"sha"`
		Entries []*treeCommitInfoEntryRaw `json:"entries"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}
	if raw.Entries == nil {
		raw.Entries = []*treeCommitInfoEntryRaw{}
	}
	entries := make([]*TreeEntry, 0, len(raw.Entries))
	for _, e := range raw.Entries {
		entries = append(entries, &TreeEntry{
			Mode:           e.Mode,
			Name:           e.Name,
			Path:           e.Path,
			Sha:            e.Sha,
			Size:           e.Size,
			LastModifiedAt: parseTreeCommitInfoDate(e),
		})
	}
	if path != "" {
		prefix := strings.TrimSuffix(path, "/") + "/"
		filtered := entries[:0]
		for _, e := range entries {
			if strings.HasPrefix(e.Path, prefix) {
				e.Name = baseName(e.Path)
				filtered = append(filtered, e)
			}
		}
		entries = filtered
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Path < entries[j].Path
	})
	return &GetRepoTreeResp{
		Entries: entries,
		SHA:     raw.SHA,
	}, nil
}

func parseTreeCommitInfoDate(e *treeCommitInfoEntryRaw) int64 {
	if e == nil {
		return 0
	}
	if e.LastModifiedAt > 0 {
		return e.LastModifiedAt
	}
	if e.Date != "" {
		if t, err := time.Parse(time.RFC3339, e.Date); err == nil {
			return t.Unix()
		}
	}
	if e.Commit != nil {
		if e.Commit.Committer != nil && e.Commit.Committer.Date != nil && *e.Commit.Committer.Date != "" {
			if t, err := time.Parse(time.RFC3339, *e.Commit.Committer.Date); err == nil {
				return t.Unix()
			}
		}
		if e.Commit.Author != nil && e.Commit.Author.Date != nil && *e.Commit.Author.Date != "" {
			if t, err := time.Parse(time.RFC3339, *e.Commit.Author.Date); err == nil {
				return t.Unix()
			}
		}
	}
	return 0
}

// GetBlob 获取单文件内容（PAT 模式）
func (g *Github) GetBlob(ctx context.Context, token, owner, repo, ref, path string) (*GetBlobResp, error) {
	cli := newClientWithToken(ctx, token)
	opts := &github.RepositoryContentGetOptions{}
	if ref != "" {
		opts.Ref = ref
	}
	fileContent, _, _, err := cli.Repositories.GetContents(ctx, owner, repo, path, opts)
	if err != nil {
		return nil, fmt.Errorf("get file content: %w", err)
	}
	if fileContent == nil {
		return nil, fmt.Errorf("path %s is a directory, not a file", path)
	}
	decoded, err := fileContent.GetContent()
	if err != nil {
		return nil, fmt.Errorf("decode file content: %w", err)
	}
	content := []byte(decoded)
	return &GetBlobResp{
		Content:  content,
		IsBinary: isBinaryContent(content),
		Sha:      fileContent.GetSHA(),
		Size:     fileContent.GetSize(),
	}, nil
}

// GetGitLogs 获取提交历史（PAT 模式）
func (g *Github) GetGitLogs(ctx context.Context, token, owner, repo, ref, path string, limit, offset int) (*GetGitLogsResp, error) {
	cli := newClientWithToken(ctx, token)
	if limit <= 0 {
		limit = 100
	}
	opts := &github.CommitsListOptions{
		ListOptions: github.ListOptions{
			Page:    (offset / limit) + 1,
			PerPage: limit,
		},
	}
	if ref != "" {
		opts.SHA = ref
	}
	if path != "" {
		opts.Path = path
	}
	commits, _, err := cli.Repositories.ListCommits(ctx, owner, repo, opts)
	if err != nil {
		return nil, fmt.Errorf("list commits: %w", err)
	}

	skip := offset % limit
	if skip > 0 && skip < len(commits) {
		commits = commits[skip:]
	} else if skip >= len(commits) {
		commits = nil
	}

	entries := make([]*GitCommitEntry, 0, len(commits))
	for _, c := range commits {
		gc := c.GetCommit()
		entry := &GitCommitEntry{
			Commit: &GitCommit{
				Sha:        c.GetSHA(),
				Message:    gc.GetMessage(),
				TreeSha:    gc.GetTree().GetSHA(),
				ParentShas: make([]string, 0, len(c.Parents)),
			},
		}
		if gc.GetAuthor() != nil {
			entry.Commit.Author = &GitUser{
				Name:  gc.GetAuthor().GetName(),
				Email: gc.GetAuthor().GetEmail(),
				When:  gc.GetAuthor().GetDate().Unix(),
			}
		}
		if gc.GetCommitter() != nil {
			entry.Commit.Committer = &GitUser{
				Name:  gc.GetCommitter().GetName(),
				Email: gc.GetCommitter().GetEmail(),
				When:  gc.GetCommitter().GetDate().Unix(),
			}
		}
		for _, p := range c.Parents {
			entry.Commit.ParentShas = append(entry.Commit.ParentShas, p.GetSHA())
		}
		entries = append(entries, entry)
	}
	return &GetGitLogsResp{
		Count:   len(entries),
		Entries: entries,
	}, nil
}

// GetRepoArchive 获取仓库压缩包（PAT 模式）
func (g *Github) GetRepoArchive(ctx context.Context, token, owner, repo, ref string) (*GetRepoArchiveResp, error) {
	cli := newClientWithToken(ctx, token)
	opts := &github.RepositoryContentGetOptions{}
	if ref != "" {
		opts.Ref = ref
	}
	archiveURL, _, err := cli.Repositories.GetArchiveLink(ctx, owner, repo, github.Tarball, opts, 5)
	if err != nil {
		return nil, fmt.Errorf("get archive link: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, archiveURL.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("create archive request: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download archive: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("archive download returned status %d", resp.StatusCode)
	}
	return &GetRepoArchiveResp{
		ContentLength: resp.ContentLength,
		ContentType:   resp.Header.Get("Content-Type"),
		Reader:        resp.Body,
	}, nil
}

func dirContentToTreeResp(contents []*github.RepositoryContent, basePath string) *GetRepoTreeResp {
	entries := make([]*TreeEntry, 0, len(contents))
	for _, c := range contents {
		mode := gitModeToInt(c.GetType(), "")
		entries = append(entries, &TreeEntry{
			Mode: mode,
			Name: c.GetName(),
			Path: c.GetPath(),
			Sha:  c.GetSHA(),
			Size: c.GetSize(),
		})
	}
	return &GetRepoTreeResp{Entries: entries}
}
