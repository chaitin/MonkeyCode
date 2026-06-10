package giturl

import (
	"fmt"
	"net/url"
	"strings"
)

// GitURL 表示从 URL 解析出来的 Git 仓库信息
type GitURL struct {
	Host  string
	Owner string
	Repo  string
}

// Parse 解析 git URL，提取 host/owner/repo
func Parse(raw string) (*GitURL, error) {
	if raw == "" {
		return nil, fmt.Errorf("empty url")
	}

	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid url: %w", err)
	}

	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 {
		return nil, fmt.Errorf("invalid git url %s", u.Path)
	}
	return &GitURL{
		Host:  u.Host,
		Owner: parts[0],
		Repo:  strings.TrimSuffix(parts[1], ".git"),
	}, nil
}

// RepoFullName 返回 owner/repo 格式的仓库全名
func RepoFullName(raw string) (string, error) {
	u, err := Parse(raw)
	if err != nil {
		return "", err
	}
	return u.Owner + "/" + u.Repo, nil
}

// ParseBranchFromURL 从 Git 仓库地址中解析分支名，如果未指定则默认返回 main
// 处理 GitHub 的 tree URL，例如: https://github.com/owner/repo/tree/feat-schema
func ParseBranchFromURL(gitURL string) string {
	const treeSegment = "/tree/"
	if _, after, ok := strings.Cut(gitURL, treeSegment); ok {
		branchPart := after
		if slashIdx := strings.Index(branchPart, "/"); slashIdx != -1 {
			branchPart = branchPart[:slashIdx]
		}
		if branchPart != "" {
			return branchPart
		}
	}
	return "main"
}

// ResolveBranch 解析分支名，优先使用配置中的 branch，如果为空则从 URL 解析或使用默认 main
func ResolveBranch(configuredBranch, repoURL string) string {
	branch := strings.TrimSpace(configuredBranch)
	if branch == "" {
		branch = ParseBranchFromURL(repoURL)
	}
	return branch
}

// NormalizeCloneURL 把仓库 URL 调整成可被 git clone 使用的形式。
//
// 当前只针对阿里云 Codeup：Codeup 仓库 URL 不带 .git 后缀时 git clone 会失败，
// 这里在 hostname 命中时自动补 .git。其它平台（GitHub/Gitee/GitLab/Gitea 等）
// 同时接受带或不带 .git 的 URL，原样返回。
//
// 同时兼容 HTTPS（https://codeup.aliyun.com/...）和 SSH（git@codeup.aliyun.com:...）两种形式。
func NormalizeCloneURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return raw
	}
	if strings.HasSuffix(raw, ".git") {
		return raw
	}
	if !strings.Contains(strings.ToLower(raw), "codeup.aliyun.com") {
		return raw
	}
	return raw + ".git"
}
