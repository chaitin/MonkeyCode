package cnb

// 默认 OpenAPI 域名
const (
	DefaultAPIHost = "api.cnb.cool"
	DefaultWebHost = "cnb.cool"
)

// Repository CNB 仓库信息 (dto.Repos4User 子集)
//
// 字段以 https://api.cnb.cool/swagger.json 为准, 只保留 MonkeyCode 关心的部分。
type Repository struct {
	ID              string `json:"id,omitempty"`
	Name            string `json:"name,omitempty"`
	Path            string `json:"path,omitempty"`            // 完整仓库路径, 如 "cnb/test"
	Description     string `json:"description,omitempty"`
	WebURL          string `json:"web_url,omitempty"`
	VisibilityLevel string `json:"visibility_level,omitempty"` // public / internal / private
	DefaultBranch   string `json:"default_branch,omitempty"`
	Site            string `json:"site,omitempty"`
}

// User CNB 用户信息 (dto.UsersResult 子集)
type User struct {
	ID       string `json:"id,omitempty"`
	Username string `json:"username,omitempty"`
	Nickname string `json:"nickname,omitempty"`
	Email    string `json:"email,omitempty"`
	Avatar   string `json:"avatar,omitempty"`
}

// Branch 分支信息 (api.Branch)
type Branch struct {
	Name      string         `json:"name,omitempty"`
	Protected bool           `json:"protected,omitempty"`
	Locked    bool           `json:"locked,omitempty"`
	Commit    *CommitSummary `json:"commit,omitempty"`
}

// CommitSummary 分支挂载的提交摘要
type CommitSummary struct {
	SHA     string `json:"sha,omitempty"`
	Message string `json:"message,omitempty"`
}

// CommitUser 提交人 (api.CommitUser)
type CommitUser struct {
	Name  string `json:"name,omitempty"`
	Email string `json:"email,omitempty"`
	Date  string `json:"date,omitempty"`
}

// CommitDetail commit 主体内容 (api.CommitDetail)
type CommitDetail struct {
	Author    *CommitUser `json:"author,omitempty"`
	Committer *CommitUser `json:"committer,omitempty"`
	Message   string      `json:"message,omitempty"`
	Tree      *TreeRef    `json:"tree,omitempty"`
}

// TreeRef commit 关联的 tree 引用
type TreeRef struct {
	SHA string `json:"sha,omitempty"`
}

// CommitParent commit 父节点
type CommitParent struct {
	SHA string `json:"sha,omitempty"`
}

// Commit 完整提交信息 (api.Commit)
type Commit struct {
	SHA       string          `json:"sha,omitempty"`
	Commit    *CommitDetail   `json:"commit,omitempty"`
	Author    *CommitUser     `json:"author,omitempty"`
	Committer *CommitUser     `json:"committer,omitempty"`
	Parents   []*CommitParent `json:"parents,omitempty"`
}

// Content 仓库内容节点 (api.Content)
//
// 同一结构既描述 tree (目录, type=tree) 也描述 blob (文件, type=blob)。
//   - type=tree 时 entries 有值, content 为空
//   - type=blob 时 content 为 base64, entries 为空
//   - type=lfs 时走 lfs_download_url
type Content struct {
	Name            string       `json:"name,omitempty"`
	Path            string       `json:"path,omitempty"`
	SHA             string       `json:"sha,omitempty"`
	Type            string       `json:"type,omitempty"`     // tree / blob / lfs / empty
	Size            int64        `json:"size,omitempty"`
	Content         string       `json:"content,omitempty"`  // blob 时为 base64
	Encoding        string       `json:"encoding,omitempty"` // base64
	Entries         []*TreeEntry `json:"entries,omitempty"`  // tree 时返回
	LFSDownloadURL  string       `json:"lfs_download_url,omitempty"`
	LFSOID          string       `json:"lfs_oid,omitempty"`
	LFSSize         int64        `json:"lfs_size,omitempty"`
}

// TreeEntry tree 目录下的子项
type TreeEntry struct {
	Name string `json:"name,omitempty"`
	Path string `json:"path,omitempty"`
	SHA  string `json:"sha,omitempty"`
	Type string `json:"type,omitempty"` // tree / blob
	Size int64  `json:"size,omitempty"`
}

// errorResponse CNB 通用错误响应
//
// CNB 错误返回格式没有严格统一, 这里覆盖常见字段; parseError 会按顺序挑第一个非空的。
type errorResponse struct {
	Code    int    `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
	Msg     string `json:"msg,omitempty"`
	Error   string `json:"error,omitempty"`
}
