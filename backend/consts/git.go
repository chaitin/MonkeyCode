package consts

// GitPlatform Git 平台类型
type GitPlatform string

const (
	GitPlatformGithub GitPlatform = "github"
	GitPlatformGitLab GitPlatform = "gitlab"
	GitPlatformGitea  GitPlatform = "gitea"
	GitPlatformGitee  GitPlatform = "gitee"
)
