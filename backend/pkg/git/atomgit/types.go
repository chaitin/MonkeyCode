package atomgit

// 默认 OpenAPI 域名 (atomgit 后台共用 GitCode 基础设施)
const (
	DefaultAPIHost = "api.atomgit.com"
	DefaultWebHost = "atomgit.com"

	// APIPrefix atomgit OpenAPI 全部路径前缀
	//
	// 官方文档站 (docs.atomgit.com) 写的是裸路径 (如 /user/info、/repos/:o/:r),
	// 但实际部署的后端是 GitCode (Gitee fork), 必须用 /api/v5/ 前缀。亲测:
	//   GET /user/info        → 404 openresty
	//   GET /api/v5/user      → 200 {login,name,id,avatar_url,...}
	// 后端返回的 self URL (followers_url 等) 也都带 /api/v5/。
	APIPrefix = "/api/v5"
)

// User 用户信息 (GET /api/v5/user)
//
// 字段以亲测响应为准: {login, name, id, avatar_url, html_url, type, url, bio, blog, company, ...}。
// id 是字符串形态 (类似 MongoDB ObjectId, 如 "676a6cbb75ce0a14eb004d1c"), 不是 int。
type User struct {
	Login     string `json:"login,omitempty"`
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	Email     string `json:"email,omitempty"`
	AvatarURL string `json:"avatar_url,omitempty"`
	HTMLURL   string `json:"html_url,omitempty"`
}

// Repository 仓库信息 (GET /api/v5/repos/:o/:r 与 /api/v5/user/repos 元素结构一致)
//
// 亲测响应:
//
//	{"id":10085664,"full_name":"caiqj/test","name":"test","path":"test",
//	 "description":"","ssh_url_to_repo":"git@gitcode.com:caiqj/test.git",
//	 "http_url_to_repo":"https://atomgit.com/caiqj/test.git",
//	 "web_url":"https://atomgit.com/caiqj/test","default_branch":"...","private":...}
//
// id 是 int64; clone/web URL 三个字段都是 _to_repo / web_url 风格 (Gitee 命名)。
type Repository struct {
	ID            int64  `json:"id,omitempty"`
	Name          string `json:"name,omitempty"`
	Path          string `json:"path,omitempty"`
	FullName      string `json:"full_name,omitempty"`
	Description   string `json:"description,omitempty"`
	DefaultBranch string `json:"default_branch,omitempty"`
	Private       bool   `json:"private,omitempty"`
	SSHURL        string `json:"ssh_url_to_repo,omitempty"`  // SSH clone URL
	HTTPURL       string `json:"http_url_to_repo,omitempty"` // HTTP clone URL
	WebURL        string `json:"web_url,omitempty"`          // 浏览器访问的页面 URL
}

// Branch 分支信息 (GET /repos/:o/:r/branches)
type Branch struct {
	Name      string         `json:"name,omitempty"`
	Protected bool           `json:"protected,omitempty"`
	Commit    *CommitSummary `json:"commit,omitempty"`
}

// CommitSummary 分支挂载的提交摘要
type CommitSummary struct {
	SHA string `json:"sha,omitempty"`
}

// TreeNode 文件树节点 (GET /repos/:o/:r/trees/:sha)
//
// type 枚举: blob / tree / symlink / commit
type TreeNode struct {
	Mode string `json:"mode,omitempty"`
	Path string `json:"path,omitempty"`
	SHA  string `json:"sha,omitempty"`
	Type string `json:"type,omitempty"`
	Size int64  `json:"size,omitempty"`
}

// TreeResp GET /repos/:o/:r/trees/:sha 响应外层
//
// atomgit 的 trees 接口实际返回是数组形态还是带 `tree` 字段的对象,
// 文档没给完整 sample。为兼容两种形态:
//   - 数组形态:由 Tree() 自行 fallback 反序列化为 []TreeNode
//   - 对象形态:这里给出 sha + tree 字段方便复用
type TreeResp struct {
	SHA  string      `json:"sha,omitempty"`
	Tree []*TreeNode `json:"tree,omitempty"`
}

// Content 仓库文件或目录内容 (GET /repos/:o/:r/contents/{path})
//
// type 枚举: file / dir / symlink / submodule
//   - type=file 时 content 为 base64, entries 为空数组
//   - type=dir  时 entries 列出子项, content 为空
type Content struct {
	Name     string         `json:"name,omitempty"`
	Path     string         `json:"path,omitempty"`
	SHA      string         `json:"sha,omitempty"`
	Size     int64          `json:"size,omitempty"`
	Type     string         `json:"type,omitempty"`
	Encoding string         `json:"encoding,omitempty"` // base64
	Content  string         `json:"content,omitempty"`
	Entries  []*ContentItem `json:"entries,omitempty"`
}

// ContentItem dir 类型 Content 的 entries 元素 (与 Content 同形,只是不带 entries)
type ContentItem struct {
	Name     string `json:"name,omitempty"`
	Path     string `json:"path,omitempty"`
	SHA      string `json:"sha,omitempty"`
	Size     int64  `json:"size,omitempty"`
	Type     string `json:"type,omitempty"`
	Encoding string `json:"encoding,omitempty"`
}

// errorResponse atomgit 通用错误响应
//
// 未见统一字段约定, 覆盖常见的几种: message / msg / error / error_description。
type errorResponse struct {
	Code             int    `json:"code,omitempty"`
	Message          string `json:"message,omitempty"`
	Msg              string `json:"msg,omitempty"`
	Error            string `json:"error,omitempty"`
	ErrorDescription string `json:"error_description,omitempty"`
}
