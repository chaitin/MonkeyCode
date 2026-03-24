package config

import (
	"strings"

	"github.com/spf13/viper"

	"github.com/chaitin/MonkeyCode/backend/pkg/logger"
)

type Config struct {
	Debug bool `mapstructure:"debug"`

	Server struct {
		Addr    string `mapstructure:"addr"`
		BaseURL string `mapstructure:"base_url"`
	} `mapstructure:"server"`

	Database Database `mapstructure:"database"`

	Redis struct {
		Host string `mapstructure:"host"`
		Port int    `mapstructure:"port"`
		Pass string `mapstructure:"pass"`
		DB   int    `mapstructure:"db"`
	} `mapstructure:"redis"`

	Session Session `mapstructure:"session"`
	SMTP    SMTP    `mapstructure:"smtp"`

	RootPath   string        `mapstructure:"root_path"`
	Logger     logger.Config `mapstructure:"logger"`
	AdminToken string        `mapstructure:"admin_token"`
	Proxies    []string      `mapstructure:"proxies"`

	TaskFlow    TaskFlow    `mapstructure:"taskflow"`
	PublicHost  PublicHost  `mapstructure:"public_host"`
	Task        Task        `mapstructure:"task"`
	TaskSummary TaskSummary `mapstructure:"task_summary"`
	Loki        Loki        `mapstructure:"loki"`
	LLM         LLM         `mapstructure:"llm"`
	Notify      Notify      `mapstructure:"notify"`
	VMIdle      VMIdle      `mapstructure:"vm_idle"`

	// Context7 API 配置
	Context7ApiKey string `mapstructure:"context7_api_key"`

	// Git 平台配置
	Github GithubConfig `mapstructure:"github"`
	Gitlab GitlabConfig `mapstructure:"gitlab"`
	Gitea  GiteaConfig  `mapstructure:"gitea"`
	Gitee  GiteeConfig  `mapstructure:"gitee"`

	InitTeam InitTeam `mapstructure:"init_team"`
}

type InitTeam struct {
	Email    string `mapstructure:"email"`
	Password string `mapstructure:"password"`
	Name     string `mapstructure:"name"`
}

type TaskFlow struct {
	GrpcHost string `mapstructure:"grpc_host"`
	GrpcPort int    `mapstructure:"grpc_port"`
	GrpcURL  string `mapstructure:"grpc_url"`
}

// PublicHost 公共主机配置（可选，内部项目通过 WithPublicHost 注入时生效）
type PublicHost struct {
	CountLimit int   `mapstructure:"count_limit"` // 每用户公共主机 VM 数量限制，0 表示不限制
	TTLLimit   int64 `mapstructure:"ttl_limit"`   // 公共主机 VM 续期上限（秒），0 表示不限制
}

// Task 任务相关配置
type Task struct {
	LogLimit         int    `mapstructure:"log_limit"`          // Loki tail 日志 limit
	TaskerTTLSeconds int    `mapstructure:"tasker_ttl_seconds"` // Tasker 状态机 TTL（秒）
	ImageID          string `mapstructure:"image_id"`           // 默认镜像 ID
	Core             int    `mapstructure:"core"`               // VM CPU 核数
	Memory           uint64 `mapstructure:"memory"`             // VM 内存（字节）
}

// TaskSummary 任务摘要生成配置
type TaskSummary struct {
	Enabled    bool   `mapstructure:"enabled"`     // 是否启用
	Model      string `mapstructure:"model"`       // 摘要生成模型 ID
	BaseURL    string `mapstructure:"base_url"`    // API Base URL
	ApiKey     string `mapstructure:"api_key"`     // API Key // nolint:revive
	Delay      int    `mapstructure:"delay"`       // 延迟时间（秒），默认 3600
	MaxChars   int    `mapstructure:"max_chars"`   // 摘要最大字符数，默认 300
	MaxWorkers int    `mapstructure:"max_workers"` // 最大消费者数量，默认 5
}

// Loki Loki 日志配置
type Loki struct {
	Addr string `mapstructure:"addr"` // Loki 服务地址
}

// LLM 大语言模型配置
type LLM struct {
	BaseURL       string `mapstructure:"base_url"`
	APIKey        string `mapstructure:"api_key"`
	Model         string `mapstructure:"model"`
	InterfaceType string `mapstructure:"interface_type"` // openai_chat, openai_responses, anthropic
}

// Notify 通知配置
type Notify struct {
	VMExpireWarningMinutes int `mapstructure:"vm_expire_warning_minutes"` // VM 过期预警时间（分钟）
}

type VMIdle struct {
	SleepSeconds   int `mapstructure:"sleep_seconds"`   // VM 空闲休眠时间（秒）
	RecycleSeconds int `mapstructure:"recycle_seconds"` // VM 空闲回收时间（秒）
}

type Session struct {
	ExpireDay int `mapstructure:"expire_day"`
}

type SMTP struct {
	Host     string `mapstructure:"host"`
	Port     string `mapstructure:"port"`
	Username string `mapstructure:"username"`
	Password string `mapstructure:"password"`
	From     string `mapstructure:"from"`
	TLS      bool   `mapstructure:"tls"`
}

type Database struct {
	Master          string `mapstructure:"master"`
	Slave           string `mapstructure:"slave"`
	MaxOpenConns    int    `mapstructure:"max_open_conns"`
	MaxIdleConns    int    `mapstructure:"max_idle_conns"`
	ConnMaxLifetime int    `mapstructure:"conn_max_lifetime"`
}

func Init(dir string) (*Config, error) {
	v := viper.New()
	v.AutomaticEnv()
	v.SetEnvPrefix("MCAI")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	v.SetDefault("debug", false)
	v.SetDefault("server.addr", ":8888")
	v.SetDefault("server.base_url", "http://localhost:8888")
	v.SetDefault("loki.addr", "http://monkeycode-ai-loki:3100")
	v.SetDefault("database.master", "")
	v.SetDefault("database.slave", "")
	v.SetDefault("database.max_open_conns", 100)
	v.SetDefault("database.max_idle_conns", 50)
	v.SetDefault("database.conn_max_lifetime", 30)
	v.SetDefault("root_path", "/app")
	v.SetDefault("logger.level", "info")
	v.SetDefault("session.expire_day", 1)
	v.SetDefault("smtp.host", "")
	v.SetDefault("smtp.port", 587)
	v.SetDefault("smtp.username", "")
	v.SetDefault("smtp.password", "")
	v.SetDefault("smtp.from", "")
	v.SetDefault("smtp.tls", false)
	v.SetDefault("redis.host", "")
	v.SetDefault("redis.port", 6379)
	v.SetDefault("redis.pass", "")
	v.SetDefault("redis.db", 0)
	v.SetDefault("vm_idle.sleep_seconds", 600)
	v.SetDefault("vm_idle.recycle_seconds", 604800)
	v.SetDefault("init_team.email", "")
	v.SetDefault("init_team.name", "")
	v.SetDefault("init_team.password", "")
	v.SetDefault("taskflow.grpc_url", "")

	v.SetConfigType("yaml")
	v.AddConfigPath(dir)
	v.SetConfigName("config")
	v.ReadInConfig()

	c := Config{}
	if err := v.Unmarshal(&c); err != nil {
		return nil, err
	}

	return &c, nil
}

// GithubConfig GitHub 配置
type GithubConfig struct {
	Token   string            `mapstructure:"token"`
	Enabled bool              `mapstructure:"enabled"`
	OAuth   GithubOAuthConfig `mapstructure:"oauth"`
}

// GithubOAuthConfig GitHub OAuth 配置
type GithubOAuthConfig struct {
	ClientID     string `mapstructure:"client_id"`
	ClientSecret string `mapstructure:"client_secret"`
	RedirectURL  string `mapstructure:"redirect_url"`
}

// GitlabConfig GitLab 配置
type GitlabConfig struct {
	Default        string                    `mapstructure:"default"`
	Instances      map[string]GitlabInstance `mapstructure:"instances"`
	WebhookSecret  string                    `mapstructure:"webhook_secret"`
	AllowedDomains []string                  `mapstructure:"allowed_domains"`
}

// GitlabInstance GitLab 实例配置
type GitlabInstance struct {
	Token   string            `mapstructure:"token"`
	BaseURL string            `mapstructure:"base_url"`
	Enabled bool              `mapstructure:"enabled"`
	OAuth   GitlabOAuthConfig `mapstructure:"oauth"`
}

// GitlabOAuthConfig GitLab OAuth 配置
type GitlabOAuthConfig struct {
	ClientID     string   `mapstructure:"client_id"`
	ClientSecret string   `mapstructure:"client_secret"`
	RedirectURL  string   `mapstructure:"redirect_url"`
	Scope        []string `mapstructure:"scope"`
}

// GiteaConfig Gitea 配置
type GiteaConfig struct {
	BaseURL string           `mapstructure:"base_url"`
	Token   string           `mapstructure:"token"`
	Enabled bool             `mapstructure:"enabled"`
	OAuth   GiteaOAuthConfig `mapstructure:"oauth"`
}

// GiteaOAuthConfig Gitea OAuth 配置
type GiteaOAuthConfig struct {
	ClientID     string `mapstructure:"client_id"`
	ClientSecret string `mapstructure:"client_secret"`
	RedirectURL  string `mapstructure:"redirect_url"`
}

// GiteeConfig Gitee 配置
type GiteeConfig struct {
	BaseURL string           `mapstructure:"base_url"`
	Token   string           `mapstructure:"token"`
	Enabled bool             `mapstructure:"enabled"`
	OAuth   GiteeOAuthConfig `mapstructure:"oauth"`
}

// GiteeOAuthConfig Gitee OAuth 配置
type GiteeOAuthConfig struct {
	ClientID     string `mapstructure:"client_id"`
	ClientSecret string `mapstructure:"client_secret"`
	RedirectURL  string `mapstructure:"redirect_url"`
}

// IsGithubEnabled 检查 GitHub 是否启用
func (c *Config) IsGithubEnabled() bool {
	return c.Github.Enabled
}

// GetGitlabToken 获取 GitLab token
func (c *Config) GetGitlabToken(instanceName string) string {
	instance, exists := c.Gitlab.Instances[instanceName]
	if !exists {
		return ""
	}
	return instance.Token
}

// GetGitlabBaseURL 获取指定 GitLab 实例的 Base URL
func (c *Config) GetGitlabBaseURL(instanceName string) string {
	instance, exists := c.Gitlab.Instances[instanceName]
	if !exists {
		return ""
	}
	return instance.BaseURL
}

// IsGitlabInstanceEnabled 检查指定 GitLab 实例是否启用
func (c *Config) IsGitlabInstanceEnabled(instanceName string) bool {
	instance, exists := c.Gitlab.Instances[instanceName]
	if !exists {
		return false
	}
	return instance.Enabled
}

// GetGiteaBaseURL 获取 Gitea Base URL
func (c *Config) GetGiteaBaseURL() string {
	return c.Gitea.BaseURL
}

// GetGiteaToken 获取 Gitea token
func (c *Config) GetGiteaToken() string {
	return c.Gitea.Token
}

// IsGiteaEnabled 检查 Gitea 是否启用
func (c *Config) IsGiteaEnabled() bool {
	return c.Gitea.Enabled
}

// GetGiteeBaseURL 获取 Gitee Base URL
func (c *Config) GetGiteeBaseURL() string {
	return c.Gitee.BaseURL
}

// GetGiteeToken 获取 Gitee token
func (c *Config) GetGiteeToken() string {
	return c.Gitee.Token
}

// IsGiteeEnabled 检查 Gitee 是否启用
func (c *Config) IsGiteeEnabled() bool {
	return c.Gitee.Enabled
}

// GetGitlabOAuthClientID 获取指定 GitLab 实例的 OAuth Client ID
func (c *Config) GetGitlabOAuthClientID(instanceName string) string {
	instance, exists := c.Gitlab.Instances[instanceName]
	if !exists {
		return ""
	}
	return instance.OAuth.ClientID
}

// GetGitlabOAuthClientSecret 获取指定 GitLab 实例的 OAuth Client Secret
func (c *Config) GetGitlabOAuthClientSecret(instanceName string) string {
	instance, exists := c.Gitlab.Instances[instanceName]
	if !exists {
		return ""
	}
	return instance.OAuth.ClientSecret
}

// GetGitlabOAuthRedirectURL 获取指定 GitLab 实例的 OAuth Redirect URL
func (c *Config) GetGitlabOAuthRedirectURL(instanceName string) string {
	instance, exists := c.Gitlab.Instances[instanceName]
	if !exists {
		return ""
	}
	if instance.OAuth.RedirectURL != "" {
		return instance.OAuth.RedirectURL
	}
	return c.Server.BaseURL + "/api/v1/oauth/gitlab/callback"
}

// GetGitlabOAuthScope 获取指定 GitLab 实例的 OAuth Scope
func (c *Config) GetGitlabOAuthScope(instanceName string) string {
	instance, exists := c.Gitlab.Instances[instanceName]
	if !exists {
		return "api"
	}
	if len(instance.OAuth.Scope) > 0 {
		return strings.Join(instance.OAuth.Scope, " ")
	}
	return "api"
}

// GetGiteaOAuthClientID 获取 Gitea OAuth Client ID
func (c *Config) GetGiteaOAuthClientID() string {
	return c.Gitea.OAuth.ClientID
}

// GetGiteaOAuthClientSecret 获取 Gitea OAuth Client Secret
func (c *Config) GetGiteaOAuthClientSecret() string {
	return c.Gitea.OAuth.ClientSecret
}

// GetGiteaOAuthRedirectURL 获取 Gitea OAuth Redirect URL
func (c *Config) GetGiteaOAuthRedirectURL() string {
	if c.Gitea.OAuth.RedirectURL != "" {
		return c.Gitea.OAuth.RedirectURL
	}
	return c.Server.BaseURL + "/api/v1/oauth/gitea/callback"
}

// GetGiteeOAuthClientID 获取 Gitee OAuth Client ID
func (c *Config) GetGiteeOAuthClientID() string {
	return c.Gitee.OAuth.ClientID
}

// GetGiteeOAuthClientSecret 获取 Gitee OAuth Client Secret
func (c *Config) GetGiteeOAuthClientSecret() string {
	return c.Gitee.OAuth.ClientSecret
}

// GetGiteeOAuthRedirectURL 获取 Gitee OAuth Redirect URL
func (c *Config) GetGiteeOAuthRedirectURL() string {
	if c.Gitee.OAuth.RedirectURL != "" {
		return c.Gitee.OAuth.RedirectURL
	}
	return c.Server.BaseURL + "/api/v1/oauth/gitee/callback"
}
