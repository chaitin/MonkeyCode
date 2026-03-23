package gitea

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

	domainpkg "github.com/chaitin/MonkeyCode/backend/domain"
)

// giteaAPIGet 通用 Gitea API GET 请求
func giteaAPIGet(ctx context.Context, apiURL, token string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("token %s", token))

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("api returned status %d: %s", resp.StatusCode, string(body))
	}
	return io.ReadAll(resp.Body)
}

// GetRepoTree 获取 Gitea 仓库文件树
func (g *Gitea) GetRepoTree(ctx context.Context, baseURL, token, owner, repo, ref, treePath string, recursive, isOAuth bool) (*GetRepoTreeResp, error) {
	if ref == "" {
		ref = "master"
	}
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/git/trees/%s", baseURL, owner, repo, url.PathEscape(ref))
	if recursive || treePath != "" {
		apiURL += "?recursive=true"
	}

	type giteaTreeNode struct {
		Path string `json:"path"`
		Mode string `json:"mode"`
		Type string `json:"type"`
		Sha  string `json:"sha"`
		Size int    `json:"size"`
	}
	type giteaTreeResp struct {
		Sha  string           `json:"sha"`
		Tree []*giteaTreeNode `json:"tree"`
	}

	body, err := giteaAPIGet(ctx, apiURL, token)
	if err != nil {
		return nil, fmt.Errorf("get tree: %w", err)
	}
	var treeResp giteaTreeResp
	if err := json.Unmarshal(body, &treeResp); err != nil {
		return nil, fmt.Errorf("unmarshal tree response: %w", err)
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
		mode := giteaTypeToMode(node.Type)
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

// GetBlob 获取 Gitea 仓库单文件内容
func (g *Gitea) GetBlob(ctx context.Context, baseURL, token, owner, repo, ref, path string, isOAuth bool) (*GetBlobResp, error) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	escapedPath := strings.Join(parts, "/")
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/contents/%s", baseURL, owner, repo, escapedPath)
	if ref != "" {
		apiURL += "?ref=" + url.QueryEscape(ref)
	}

	type giteaContentResp struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
		Sha      string `json:"sha"`
		Size     int    `json:"size"`
	}

	body, err := giteaAPIGet(ctx, apiURL, token)
	if err != nil {
		return nil, fmt.Errorf("get file content: %w", err)
	}
	var contentResp giteaContentResp
	if err := json.Unmarshal(body, &contentResp); err != nil {
		return nil, fmt.Errorf("unmarshal content response: %w", err)
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

// GetGitLogs 获取 Gitea 仓库提交历史
func (g *Gitea) GetGitLogs(ctx context.Context, baseURL, token, owner, repo, ref, path string, limit, offset int, isOAuth bool) (*GetGitLogsResp, error) {
	if limit <= 0 {
		limit = 50
	}
	page := (offset / limit) + 1
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/commits?page=%d&limit=%d",
		baseURL, owner, repo, page, limit)
	if ref != "" {
		apiURL += "&sha=" + url.QueryEscape(ref)
	}
	if path != "" {
		apiURL += "&path=" + url.QueryEscape(path)
	}

	type giteaCommitUser struct {
		Name  string `json:"name"`
		Email string `json:"email"`
		Date  string `json:"date"`
	}
	type giteaCommitDetail struct {
		Message   string           `json:"message"`
		Author    *giteaCommitUser `json:"author"`
		Committer *giteaCommitUser `json:"committer"`
	}
	type giteaParent struct {
		Sha string `json:"sha"`
	}
	type giteaCommitResp struct {
		Sha     string             `json:"sha"`
		Commit  *giteaCommitDetail `json:"commit"`
		Parents []*giteaParent     `json:"parents"`
	}

	body, err := giteaAPIGet(ctx, apiURL, token)
	if err != nil {
		return nil, fmt.Errorf("get commits: %w", err)
	}
	var commits []giteaCommitResp
	if err := json.Unmarshal(body, &commits); err != nil {
		return nil, fmt.Errorf("unmarshal commits response: %w", err)
	}

	if skip := offset % limit; skip > 0 {
		if skip >= len(commits) {
			commits = nil
		} else {
			commits = commits[skip:]
		}
	}

	entries := make([]*GitCommitEntry, 0, len(commits))
	for _, c := range commits {
		entry := &GitCommitEntry{
			Commit: &GitCommit{
				Sha:     c.Sha,
				Message: "",
			},
		}
		if c.Commit != nil {
			entry.Commit.Message = c.Commit.Message
			if c.Commit.Author != nil {
				entry.Commit.Author = &GitUser{
					Name:  c.Commit.Author.Name,
					Email: c.Commit.Author.Email,
					When:  parseGiteaDate(c.Commit.Author.Date),
				}
			}
			if c.Commit.Committer != nil {
				entry.Commit.Committer = &GitUser{
					Name:  c.Commit.Committer.Name,
					Email: c.Commit.Committer.Email,
					When:  parseGiteaDate(c.Commit.Committer.Date),
				}
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

// GetRepoArchive 获取 Gitea 仓库压缩包
func (g *Gitea) GetRepoArchive(ctx context.Context, baseURL, token, owner, repo, ref string, isOAuth bool) (*GetRepoArchiveResp, error) {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/archive/%s.tar.gz",
		baseURL, owner, repo, url.PathEscape(ref))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", fmt.Sprintf("token %s", token))
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
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

// ListBranches 获取 Gitea 仓库分支列表
func ListBranches(ctx context.Context, baseURL, token, owner, repo string, page, perPage int, isOAuth bool) ([]*BranchInfo, error) {
	apiURL := fmt.Sprintf("%s/api/v1/repos/%s/%s/branches?page=%d&limit=%d",
		baseURL, url.PathEscape(owner), url.PathEscape(repo), page, perPage)
	body, err := giteaAPIGet(ctx, apiURL, token)
	if err != nil {
		return nil, fmt.Errorf("list branches: %w", err)
	}
	type giteaBranch struct {
		Name string `json:"name"`
	}
	var branches []giteaBranch
	if err := json.Unmarshal(body, &branches); err != nil {
		return nil, fmt.Errorf("unmarshal branches: %w", err)
	}
	result := make([]*BranchInfo, 0, len(branches))
	for _, b := range branches {
		result = append(result, &BranchInfo{Name: b.Name})
	}
	return result, nil
}

// GetAuthorizedRepositories 获取 token 可访问的仓库列表
func (g *Gitea) GetAuthorizedRepositories(ctx context.Context, token string) ([]domainpkg.AuthRepository, error) {
	apiURL := fmt.Sprintf("%s/api/v1/user/repos?limit=100", g.baseURL)
	var all []domainpkg.AuthRepository
	page := 1
	for {
		pagedURL := fmt.Sprintf("%s&page=%d", apiURL, page)
		body, err := giteaAPIGet(ctx, pagedURL, token)
		if err != nil {
			return nil, fmt.Errorf("list repos: %w", err)
		}
		type giteaRepo struct {
			FullName    string `json:"full_name"`
			CloneURL    string `json:"clone_url"`
			Description string `json:"description"`
		}
		var repos []giteaRepo
		if err := json.Unmarshal(body, &repos); err != nil {
			return nil, fmt.Errorf("unmarshal repos: %w", err)
		}
		if len(repos) == 0 {
			break
		}
		for _, r := range repos {
			all = append(all, domainpkg.AuthRepository{
				FullName:    r.FullName,
				URL:         r.CloneURL,
				Description: r.Description,
			})
		}
		if len(repos) < 100 {
			break
		}
		page++
	}
	return all, nil
}

func giteaTypeToMode(entryType string) int {
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

func parseGiteaDate(dateStr string) int64 {
	if dateStr == "" {
		return 0
	}
	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
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
