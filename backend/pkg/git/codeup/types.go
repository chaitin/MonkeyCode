package codeup

import (
	"bytes"
	"strconv"
)

// 默认 OpenAPI 域名（公网公共站）
const DefaultOpenAPIHost = "openapi-rdc.aliyuncs.com"

// flexibleInt 兼容云效返回的 int 或字符串数字（如 "1666"）。
type flexibleInt int

func (f *flexibleInt) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if len(data) == 0 || bytes.Equal(data, []byte("null")) {
		return nil
	}
	if data[0] == '"' && data[len(data)-1] == '"' {
		data = data[1 : len(data)-1]
	}
	if len(data) == 0 {
		return nil
	}
	n, err := strconv.ParseInt(string(data), 10, 64)
	if err != nil {
		return err
	}
	*f = flexibleInt(n)
	return nil
}

// Repository 仓库信息
//
// 字段以「查询代码库列表」文档为准；HTTPCloneURL / SSHCloneURL / DefaultBranch / Permissions
// 在列表接口里不一定出现，但「查询单个代码库」可能返回，保留为可选字段不影响反序列化。
type Repository struct {
	ID            int64    `json:"id,omitempty"`
	Name          string   `json:"name,omitempty"`
	Path          string   `json:"path,omitempty"`
	NameWithNs    string   `json:"nameWithNamespace,omitempty"`
	PathWithNs    string   `json:"pathWithNamespace,omitempty"`
	Description   string   `json:"description,omitempty"`
	Visibility    string   `json:"visibility,omitempty"` // private / internal
	WebURL        string   `json:"webUrl,omitempty"`
	HTTPCloneURL  string   `json:"httpCloneUrl,omitempty"`
	SSHCloneURL   string   `json:"sshCloneUrl,omitempty"`
	DefaultBranch string   `json:"defaultBranch,omitempty"`
	Permissions   []string `json:"permissions,omitempty"`
	Archived      bool     `json:"archived,omitempty"`
}

// Branch 分支
type Branch struct {
	Name      string         `json:"name,omitempty"`
	Protected bool           `json:"protected,omitempty"`
	Commit    *CommitSummary `json:"commit,omitempty"`
}

// CommitSummary 分支挂载的提交摘要
type CommitSummary struct {
	ID        string `json:"id,omitempty"`
	ShortID   string `json:"shortId,omitempty"`
	Title     string `json:"title,omitempty"`
	AuthoredAt string `json:"authoredDate,omitempty"`
}

// TreeNode 文件树节点
type TreeNode struct {
	ID    string `json:"id,omitempty"`
	Name  string `json:"name,omitempty"`
	Type  string `json:"type,omitempty"` // tree / blob / commit
	Path  string `json:"path,omitempty"`
	Mode  string `json:"mode,omitempty"`
	IsLFS bool   `json:"isLFS,omitempty"`
}

// FileBlob 文件内容
//
// 注意：云效返回的 size 字段有时是字符串（如 "1666"），有时是数字，用 flexibleInt 兼容。
type FileBlob struct {
	FileName    string       `json:"fileName,omitempty"`
	FilePath    string       `json:"filePath,omitempty"`
	Size        flexibleInt  `json:"size,omitempty"`
	Encoding    string       `json:"encoding,omitempty"` // base64 / text
	Content     string       `json:"content,omitempty"`
	CommitID    string       `json:"commitId,omitempty"`
	LastCommitID string      `json:"lastCommitId,omitempty"`
	Ref         string       `json:"ref,omitempty"`
	BlobID      string       `json:"blobId,omitempty"`
}

// CommitStats 提交变更行数统计
type CommitStats struct {
	Additions int `json:"additions,omitempty"`
	Deletions int `json:"deletions,omitempty"`
	Total     int `json:"total,omitempty"`
}

// CommitItem 完整提交信息
type CommitItem struct {
	ID             string       `json:"id,omitempty"`
	ShortID        string       `json:"shortId,omitempty"`
	Title          string       `json:"title,omitempty"`
	Message        string       `json:"message,omitempty"`
	ParentIDs      []string     `json:"parentIds,omitempty"`
	AuthorName     string       `json:"authorName,omitempty"`
	AuthorEmail    string       `json:"authorEmail,omitempty"`
	AuthoredDate   string       `json:"authoredDate,omitempty"`
	CommitterName  string       `json:"committerName,omitempty"`
	CommitterEmail string       `json:"committerEmail,omitempty"`
	CommittedDate  string       `json:"committedDate,omitempty"`
	Stats          *CommitStats `json:"stats,omitempty"`
	WebURL         string       `json:"webUrl,omitempty"`
}

// OrganizationItem 云效组织条目（来自 /oapi/v1/platform/organizations）
type OrganizationItem struct {
	ID          string `json:"id,omitempty"`
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
	CreatorID   string `json:"creatorId,omitempty"`
	DefaultRole string `json:"defaultRole,omitempty"`
	CreatedAt   string `json:"createdAt,omitempty"`
	UpdateAt    string `json:"updateAt,omitempty"`
}

// WebhookItem 仓库 webhook
type WebhookItem struct {
	ID          int64  `json:"id,omitempty"`
	URL         string `json:"url,omitempty"`
	Description string `json:"description,omitempty"`
}

// errorResponse 云效错误响应
type errorResponse struct {
	ErrorCode    string `json:"errorCode,omitempty"`
	ErrorMessage string `json:"errorMessage,omitempty"`
	Message      string `json:"message,omitempty"`
	RequestID    string `json:"requestId,omitempty"`
}
