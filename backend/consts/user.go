package consts

type UserPlatform string

const (
	UserPlatformBaizhi UserPlatform = "baizhi" // 百智云平台
	UserPlatformGithub UserPlatform = "github"
	UserPlatformGitLab UserPlatform = "gitlab"
	UserPlatformGitea  UserPlatform = "gitea"
	UserPlatformGitee  UserPlatform = "gitee"
)

type UserStatus string

const (
	UserStatusActive   UserStatus = "active"
	UserStatusInactive UserStatus = "inactive"
)

type UserRole string

const (
	UserRoleIndividual UserRole = "individual" // 个人用户
	UserRoleEnterprise UserRole = "enterprise" // 企业用户
	UserRoleSubAccount UserRole = "subaccount" // 企业子账户
	UserRoleAdmin      UserRole = "admin"      // MonkeyCode-AI 管理员账号，用来配置公共资源. 如公共宿主机等
)

type RedisKey string

const (
	UserActiveKey RedisKey = "monkeycode_ai:user:active"
)

type DefaultConfigType string

const (
	DefaultConfigTypeModel DefaultConfigType = "model"
	DefaultConfigTypeImage DefaultConfigType = "image"
	DefaultConfigTypeHost  DefaultConfigType = "host"
	UserRoleGitTask        UserRole          = "gittask" // 全自动 git 任务插入的用户
)
