package gitlab

import (
	"io"
)

// BranchInfo 分支信息
type BranchInfo struct {
	Name string `json:"name"`
}

// TreeEntry 文件树节点
type TreeEntry struct {
	Mode int    `json:"mode"`
	Name string `json:"name"`
	Path string `json:"path"`
	Sha  string `json:"sha"`
	Size int    `json:"size"`
}

// GetRepoTreeResp 获取仓库文件树响应
type GetRepoTreeResp struct {
	Entries []*TreeEntry `json:"entries"`
	SHA     string       `json:"sha"`
}

// GetBlobResp 获取单文件内容响应
type GetBlobResp struct {
	Content  []byte `json:"content"`
	IsBinary bool   `json:"is_binary"`
	Sha      string `json:"sha"`
	Size     int    `json:"size"`
}

// GitUser 提交用户信息
type GitUser struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	When  int64  `json:"when"`
}

// GitCommit 提交信息
type GitCommit struct {
	Author     *GitUser `json:"author"`
	Committer  *GitUser `json:"committer"`
	Message    string   `json:"message"`
	ParentShas []string `json:"parent_shas"`
	Sha        string   `json:"sha"`
	TreeSha    string   `json:"tree_sha"`
}

// GitCommitEntry 包装 commit 对象
type GitCommitEntry struct {
	Commit *GitCommit `json:"commit"`
}

// GetGitLogsResp 获取提交历史响应
type GetGitLogsResp struct {
	Count   int               `json:"count"`
	Entries []*GitCommitEntry `json:"entries"`
}

// GetRepoArchiveResp 获取仓库压缩包响应
type GetRepoArchiveResp struct {
	ContentLength int64
	ContentType   string
	Reader        io.ReadCloser
}
