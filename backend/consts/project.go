package consts

// ProjectCollaboratorRole 项目协作者角色
type ProjectCollaboratorRole string

const (
	ProjectCollaboratorRoleReadOnly  ProjectCollaboratorRole = "read_only"
	ProjectCollaboratorRoleReadWrite ProjectCollaboratorRole = "read_write"
)

// ProjectIssueStatus 项目 Issue 状态
type ProjectIssueStatus string

const (
	ProjectIssueStatusOpen      ProjectIssueStatus = "open"
	ProjectIssueStatusClosed    ProjectIssueStatus = "closed"
	ProjectIssueStatusCompleted ProjectIssueStatus = "completed"
)

// ProjectIssuePriority 项目 Issue 优先级
type ProjectIssuePriority int

const (
	ProjectIssuePriorityOne   ProjectIssuePriority = 1
	ProjectIssuePriorityTwo   ProjectIssuePriority = 2
	ProjectIssuePriorityThree ProjectIssuePriority = 3
)
