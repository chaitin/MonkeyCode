package gitee

// Repository 仓库信息
type Repository struct {
	ID            int64                 `json:"id,omitempty"`
	FullName      string                `json:"full_name,omitempty"`
	HumanName     string                `json:"human_name,omitempty"`
	Path          string                `json:"path,omitempty"`
	Name          string                `json:"name,omitempty"`
	Owner         *User                 `json:"owner,omitempty"`
	Description   string                `json:"description,omitempty"`
	Private       bool                  `json:"private,omitempty"`
	Fork          bool                  `json:"fork,omitempty"`
	URL           string                `json:"url,omitempty"`
	HTMLURL       string                `json:"html_url,omitempty"`
	SSHURL        string                `json:"ssh_url,omitempty"`
	DefaultBranch string                `json:"default_branch,omitempty"`
	Permission    *RepositoryPermission `json:"permission,omitempty"`
}

// RepositoryPermission 表示当前 token 在该仓库下的权限
type RepositoryPermission struct {
	Admin bool `json:"admin"`
	Push  bool `json:"push"`
	Pull  bool `json:"pull"`
}

// User 表示 Gitee 用户信息
type User struct {
	ID        int64  `json:"id,omitempty"`
	Login     string `json:"login,omitempty"`
	Name      string `json:"name,omitempty"`
	AvatarURL string `json:"avatar_url,omitempty"`
	URL       string `json:"url,omitempty"`
	HTMLURL   string `json:"html_url,omitempty"`
	Email     string `json:"email,omitempty"`
}
