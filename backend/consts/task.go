package consts

// TaskStatus 任务状态
type TaskStatus string

const (
	TaskStatusPending    TaskStatus = "pending"
	TaskStatusProcessing TaskStatus = "processing"
	TaskStatusError      TaskStatus = "error"
	TaskStatusFinished   TaskStatus = "finished"
)

// TaskStreamType 任务流消息类型
type TaskStreamType string

const (
	TaskStreamTypePing               TaskStreamType = "ping"
	TaskStreamTypeError              TaskStreamType = "error"
	TaskStreamTypeTaskRunning        TaskStreamType = "task-running"
	TaskStreamTypeTaskEvent          TaskStreamType = "task-event"
	TaskStreamTypePermissionResp     TaskStreamType = "permission-resp"
	TaskStreamTypeUserInput          TaskStreamType = "user-input"
	TaskStreamTypeUserStop           TaskStreamType = "user-stop"
	TaskStreamTypeUserCancel         TaskStreamType = "user-cancel"
	TaskStreamTypeAutoApprove        TaskStreamType = "auto-approve"
	TaskStreamTypeDisableAutoApprove TaskStreamType = "disable-auto-approve"
	TaskStreamTypeReplyQuestion      TaskStreamType = "reply-question"
	TaskStreamTypeCall               TaskStreamType = "call"
	TaskStreamTypeCallResponse       TaskStreamType = "call-response"
	TaskStreamTypeSyncWebClientIP    TaskStreamType = "sync-my-ip"
	TaskStreamTypeCursor             TaskStreamType = "cursor"
)

// CliName 命令行工具名称
type CliName string

const (
	CliNameCodex    CliName = "codex"
	CliNameClaude   CliName = "claude"
	CliNameOpencode CliName = "opencode"
)

// TaskType 任务类型
type TaskType string

const (
	TaskTypeDevelop TaskType = "develop"
	TaskTypeDesign  TaskType = "design"
	TaskTypeReview  TaskType = "review"
)

// TaskSubType 任务子类型
type TaskSubType string

const (
	TaskSubTypeGenerateDocs        TaskSubType = "generate_docs"
	TaskSubTypeGenerateRequirement TaskSubType = "generate_requirement"
	TaskSubTypeGenerateDesign      TaskSubType = "generate_design"
	TaskSubTypeGenerateTasklist    TaskSubType = "generate_tasklist"
	TaskSubTypeExecuteTask         TaskSubType = "execute_task"
	TaskSubTypePrReview            TaskSubType = "pr_review"
)

// TaskSummaryQueueKey 任务摘要队列 Redis key
const TaskSummaryQueueKey = "tasksummary:queue"

// SkillBaseDir 技能文件存储基目录
const SkillBaseDir = "/app/skills"
