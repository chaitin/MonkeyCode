package config

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"

	"github.com/chaitin/MonkeyCode/backend/consts"
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

	LLMProxy struct {
		Addr                 string `mapstructure:"addr"`
		BaseURL              string `mapstructure:"base_url"`
		Timeout              string `mapstructure:"timeout"`
		KeepAlive            string `mapstructure:"keep_alive"`
		ClientPoolSize       int    `mapstructure:"client_pool_size"`
		StreamClientPoolSize int    `mapstructure:"stream_client_pool_size"`
		RequestLogPath       string `mapstructure:"request_log_path"`
	} `mapstructure:"llm_proxy"`

	RootPath   string        `mapstructure:"root_path"`
	Logger     logger.Config `mapstructure:"logger"`
	AdminToken string        `mapstructure:"admin_token"`
	Proxies    []string      `mapstructure:"proxies"`

	TaskFlow      TaskFlow            `mapstructure:"taskflow"`
	MCPHub        MCPHub              `mapstructure:"mcp_hub"`
	PublicHost    PublicHost          `mapstructure:"public_host"`
	Task          Task                `mapstructure:"task"`
	TaskSummary   TaskSummary         `mapstructure:"task_summary"`
	Loki          Loki                `mapstructure:"loki"`
	ClickHouse    ClickHouse          `mapstructure:"clickhouse"`
	LLM           LLM                 `mapstructure:"llm"`
	Notify        Notify              `mapstructure:"notify"`
	VMIdle        VMIdle              `mapstructure:"vm_idle"`
	Attachment    Attachment          `mapstructure:"attachment"`
	ObjectStorage ObjectStorageConfig `mapstructure:"object_storage"`
	StaticFiles   StaticFilesConfig   `mapstructure:"static_files"`
	HostInstaller HostInstaller       `mapstructure:"host_installer"`

	// Context7 API 配置
	Context7ApiKey string `mapstructure:"context7_api_key"`

	// Git 平台配置
	Github GithubConfig `mapstructure:"github"`
	Gitlab GitlabConfig `mapstructure:"gitlab"`
	Gitea  GiteaConfig  `mapstructure:"gitea"`
	Gitee  GiteeConfig  `mapstructure:"gitee"`
	Codeup  CodeupConfig  `mapstructure:"codeup"`
	Cnb     CnbConfig     `mapstructure:"cnb"`
	Atomgit AtomgitConfig `mapstructure:"atomgit"`

	// 微信配置（开放平台 OAuth 登录 + 公众号消息推送）
	Wechat WechatConfig `mapstructure:"wechat"`

	InitTeam InitTeam `mapstructure:"init_team"`

	// 语音识别配置（阿里云 NLS，用于一段录音 POST 接口）
	NLS NLS `mapstructure:"nls"`

	// 流式语音识别配置（豆包 SAUC bigmodel，用于 WS 实时流式接口）
	Doubao Doubao `mapstructure:"doubao"`

	ReviewAgent ReviewAgent `mapstructure:"review_agent"`
}

type ReviewAgent struct {
	ModelID string `mapstructure:"model_id"`
	Image   string `mapstructure:"image"`
}

// NLS 阿里云语音识别配置
type NLS struct {
	AppKey string `mapstructure:"app_key"`
	AkID   string `mapstructure:"ak_id"`
	AkKey  string `mapstructure:"ak_key"`
}

// Doubao 豆包流式语音识别 2.0 配置 (火山引擎 SAUC bigmodel)。
// 新版控制台:只需 AppKey 一个鉴权字段 (作为 X-Api-Key header)。
type Doubao struct {
	// 火山控制台获取的 App Key,作为 X-Api-Key header 发送
	AppKey string `mapstructure:"app_key"`
	// 资源 ID;ASR 2.0 取值: volc.seedasr.sauc.duration (按时长) 或 volc.seedasr.sauc.concurrent (按并发)
	ResourceID string `mapstructure:"resource_id"`
	// WebSocket URL,默认 wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
	URL string `mapstructure:"url"`
	// 自学习平台上预建的热词词表 ID (单表最多 5000 个热词)。
	// BoostingTableID 与 BoostingTableName 二选一即可,同时配置时豆包优先用 ID。
	BoostingTableID string `mapstructure:"boosting_table_id"`
	// 自学习平台上预建的热词词表名称,可替代 BoostingTableID 使用 (改名会失效,推荐用 ID)
	BoostingTableName string `mapstructure:"boosting_table_name"`
}

type InitTeam struct {
	Email    string `mapstructure:"email"`
	Password string `mapstructure:"password"`
	Name     string `mapstructure:"name"`
	Image    string `mapstructure:"image"`
}

type TaskFlow struct {
	GrpcHost string `mapstructure:"grpc_host"`
	GrpcPort int    `mapstructure:"grpc_port"`
	GrpcURL  string `mapstructure:"grpc_url"`
}

type MCPHub struct {
	Enabled bool   `mapstructure:"enabled"`
	URL     string `mapstructure:"url"`
	Token   string `mapstructure:"token"`
}

// PublicHost 公共主机配置（可选，内部项目通过 WithPublicHost 注入时生效）
type PublicHost struct {
	CountLimit int   `mapstructure:"count_limit"` // 每用户公共主机 VM 数量限制，0 表示不限制
	TTLLimit   int64 `mapstructure:"ttl_limit"`   // 公共主机 VM 续期上限（秒），0 表示不限制
}

type Attachment struct {
	AllowedURLPrefixes []string `mapstructure:"allowed_url_prefixes"`
}

type ObjectStorageConfig struct {
	Enabled         bool   `mapstructure:"enabled"`
	Provider        string `mapstructure:"provider"`
	ForcePathStyle  bool   `mapstructure:"force_path_style"`
	InitBucket      bool   `mapstructure:"init_bucket"`
	PresignExpires  string `mapstructure:"presign_expires"`
	Endpoint        string `mapstructure:"endpoint"`
	AccessEndpoint  string `mapstructure:"access_endpoint"`
	AccessKey       string `mapstructure:"access_key"`
	AccessKeySecret string `mapstructure:"access_key_secret"`
	Bucket          string `mapstructure:"bucket"`
	Region          string `mapstructure:"region"`
	MaxSize         int64  `mapstructure:"max_size"`
	AvatarPrefix    string `mapstructure:"avatar_prefix"`
	SpecPrefix      string `mapstructure:"spec_prefix"`
	RepoPrefix      string `mapstructure:"repo_prefix"`
	TempPrefix      string `mapstructure:"temp_prefix"`
}

type StaticFilesConfig struct {
	Enabled     bool   `mapstructure:"enabled"`
	Dir         string `mapstructure:"dir"`
	RoutePrefix string `mapstructure:"route_prefix"`
}

type HostInstaller struct {
	Mode       string `mapstructure:"mode"`
	BundlePath string `mapstructure:"bundle_path"`
}

// Task 任务相关配置
type Task struct {
	LogLimit            int    `mapstructure:"log_limit"`              // Loki tail 日志 limit
	TaskerTTLSeconds    int    `mapstructure:"tasker_ttl_seconds"`     // Tasker 状态机 TTL（秒）
	CreateReqTTLSeconds int    `mapstructure:"create_req_ttl_seconds"` // 创建任务请求 Redis TTL（秒）
	ImageID             string `mapstructure:"image_id"`               // 默认镜像 ID
	Core                int    `mapstructure:"core"`                   // VM CPU 核数
	Memory              uint64 `mapstructure:"memory"`                 // VM 内存（字节）
}

// TaskSummary 任务摘要生成配置
type TaskSummary struct {
	Enabled       bool   `mapstructure:"enabled"`        // 是否启用
	Model         string `mapstructure:"model"`          // 摘要生成模型 ID
	BaseURL       string `mapstructure:"base_url"`       // API Base URL
	ApiKey        string `mapstructure:"api_key"`        // API Key // nolint:revive
	InterfaceType string `mapstructure:"interface_type"` // API 接口类型（openai_chat/openai_responses/anthropic）
	Delay         int    `mapstructure:"delay"`          // 延迟时间（秒），默认 3600
	MaxChars      int    `mapstructure:"max_chars"`      // 摘要最大字符数，默认 300
	MaxRounds     int    `mapstructure:"max_rounds"`     // 最近对话轮数，默认 3
	MaxWorkers    int    `mapstructure:"max_workers"`    // 最大消费者数量，默认 5
}

// Loki Loki 日志配置
type Loki struct {
	Addr string `mapstructure:"addr"` // Loki 服务地址
}

type ClickHouse struct {
	Addr            string `mapstructure:"addr"`
	Database        string `mapstructure:"database"`
	Table           string `mapstructure:"table"`
	ModelUsageTable string `mapstructure:"model_usage_table"`
	InitEnabled     bool   `mapstructure:"init_enabled"`
	Username        string `mapstructure:"username"`
	Password        string `mapstructure:"password"`
	ReadUsername    string `mapstructure:"read_username"`
	ReadPassword    string `mapstructure:"read_password"`
	MaxOpenConns    int    `mapstructure:"max_open_conns"`
	MaxIdleConns    int    `mapstructure:"max_idle_conns"`
	ConnMaxLifetime int    `mapstructure:"conn_max_lifetime"`
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
	SleepSeconds                  int   `mapstructure:"sleep_seconds"`                     // VM 空闲休眠时间（秒）
	RecycleSeconds                int   `mapstructure:"recycle_seconds"`                   // VM 空闲回收时间（秒）
	RecycleWarnWechatLeadSeconds  []int `mapstructure:"recycle_warn_wechat_lead_seconds"`  // VM 回收前，微信公众号档每个 tier 的提前预警时长（秒），可配多档；缺省 [7200, 900]
	RecycleWarnDefaultLeadSeconds int   `mapstructure:"recycle_warn_default_lead_seconds"` // VM 回收前，非微信公众号渠道（钉钉/飞书等）的提前预警时长（秒），<=0 视为禁用该档；缺省 3600
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
	v.SetDefault("server.base_url", "")
	v.SetDefault("loki.addr", "http://monkeycode-ai-loki:3100")
	v.SetDefault("clickhouse.addr", "")
	v.SetDefault("clickhouse.database", "")
	v.SetDefault("clickhouse.table", "task_logs")
	v.SetDefault("clickhouse.model_usage_table", "model_usage_events")
	v.SetDefault("clickhouse.init_enabled", false)
	v.SetDefault("clickhouse.username", "")
	v.SetDefault("clickhouse.password", "")
	v.SetDefault("clickhouse.read_username", "")
	v.SetDefault("clickhouse.read_password", "")
	v.SetDefault("clickhouse.max_open_conns", 64)
	v.SetDefault("clickhouse.max_idle_conns", 32)
	v.SetDefault("clickhouse.conn_max_lifetime", 3600)
	v.SetDefault("database.master", "")
	v.SetDefault("database.slave", "")
	v.SetDefault("database.max_open_conns", 100)
	v.SetDefault("database.max_idle_conns", 50)
	v.SetDefault("database.conn_max_lifetime", 30)
	v.SetDefault("root_path", "/app")
	v.SetDefault("logger.level", "info")
	v.SetDefault("session.expire_day", 30)
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
	v.SetDefault("vm_idle.sleep_seconds", 900)
	v.SetDefault("vm_idle.recycle_seconds", 259200)
	v.SetDefault("init_team.email", "")
	v.SetDefault("init_team.name", "")
	v.SetDefault("init_team.password", "")
	v.SetDefault("init_team.image", "")
	v.SetDefault("taskflow.grpc_url", "")
	v.SetDefault("task.at_keyword", "")
	v.SetDefault("task.host_ids", []string{})
	v.SetDefault("task.create_req_ttl_seconds", 600)
	v.SetDefault("mcp_hub.enabled", false)
	v.SetDefault("mcp_hub.url", "")
	v.SetDefault("mcp_hub.token", "")
	v.SetDefault("attachment.allowed_url_prefixes", []string{})
	v.SetDefault("object_storage.enabled", false)
	v.SetDefault("object_storage.provider", "s3")
	v.SetDefault("object_storage.force_path_style", true)
	v.SetDefault("object_storage.init_bucket", false)
	v.SetDefault("object_storage.presign_expires", "168h")
	v.SetDefault("object_storage.endpoint", "http://monkeycode-ai-rustfs:9000")
	v.SetDefault("object_storage.access_endpoint", "")
	v.SetDefault("object_storage.access_key", "")
	v.SetDefault("object_storage.access_key_secret", "")
	v.SetDefault("object_storage.bucket", "monkeycode-ai")
	v.SetDefault("object_storage.region", "us-east-1")
	v.SetDefault("object_storage.max_size", 50<<20)
	v.SetDefault("object_storage.avatar_prefix", "avatar")
	v.SetDefault("object_storage.spec_prefix", "spec")
	v.SetDefault("object_storage.repo_prefix", "repo")
	v.SetDefault("object_storage.temp_prefix", "temp")
	v.SetDefault("static_files.enabled", true)
	v.SetDefault("static_files.dir", "/app/static")
	v.SetDefault("static_files.route_prefix", "/static")
	v.SetDefault("host_installer.mode", "online")
	v.SetDefault("host_installer.bundle_path", "installer/{{.arch}}/host.tgz")
	v.SetDefault("llm_proxy.base_url", "")
	v.SetDefault("wechat.open.app_id", "")
	v.SetDefault("wechat.open.app_secret", "")
	v.SetDefault("wechat.open.scope", "snsapi_login")
	v.SetDefault("wechat.mp.app_id", "")
	v.SetDefault("wechat.mp.app_secret", "")
	v.SetDefault("wechat.mp.token", "")
	v.SetDefault("wechat.mp.templates", map[string]string{})

	v.SetConfigType("yaml")
	v.AddConfigPath(dir)
	v.SetConfigName("config")
	v.ReadInConfig()

	if err := normalizeWechatMPTemplates(v); err != nil {
		return nil, err
	}

	c := Config{}
	if err := v.Unmarshal(&c); err != nil {
		return nil, err
	}

	return &c, nil
}

func normalizeWechatMPTemplates(v *viper.Viper) error {
	raw := v.GetStringMap("wechat.mp.templates")
	if len(raw) == 0 {
		return nil
	}

	flat := make(map[string]string, len(raw))
	for key, value := range raw {
		valueStr, ok := value.(string)
		if !ok {
			return fmt.Errorf("invalid wechat.mp.templates value type at %s: %T", key, value)
		}

		normalizedKey := normalizeWechatMPTemplateKey(key)
		if _, exists := flat[normalizedKey]; exists && normalizedKey != key {
			continue
		}
		flat[normalizedKey] = valueStr
	}

	v.Set("wechat.mp.templates", flat)
	return nil
}

func normalizeWechatMPTemplateKey(key string) string {
	switch key {
	case "vm_expiring_soon":
		return string(consts.NotifyEventVMExpiringSoon)
	case "quota_refreshed":
		return string(consts.NotifyEventQuotaRefreshed)
	case "quota_basic_exhausted":
		return string(consts.NotifyEventQuotaBasicExhausted)
	case "quota_pro_exhausted":
		return string(consts.NotifyEventQuotaProExhausted)
	case "quota_ultra_exhausted":
		return string(consts.NotifyEventQuotaUltraExhausted)
	default:
		return key
	}
}

// GithubConfig GitHub 配置
type GithubConfig struct {
	Token   string            `mapstructure:"token"`
	Enabled bool              `mapstructure:"enabled"`
	App     GithubAppConfig   `mapstructure:"app"`
	OAuth   GithubOAuthConfig `mapstructure:"oauth"`
}

type GithubAppConfig struct {
	ID            int64  `mapstructure:"id"`
	WebhookSecret string `mapstructure:"webhook_secret"`
	PrivateKey    string `mapstructure:"private_key"`
	RedirectURL   string `mapstructure:"redirect_url"` // 安装完 GitHub App 后的跳转地址
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

// CodeupConfig 阿里云云效 Codeup 配置
type CodeupConfig struct {
	// OpenAPI 域名（默认 https://openapi-rdc.aliyuncs.com，专有云可覆盖）
	BaseURL string            `mapstructure:"base_url"`
	Enabled bool              `mapstructure:"enabled"`
	OAuth   CodeupOAuthConfig `mapstructure:"oauth"`
}

// CodeupOAuthConfig Codeup OAuth 配置（走阿里云账号 OAuth2）
//
// ⚠️ 暂未启用：云效 OAuth（POST /login/oauth/create）官方仍在内测，且响应不返回
// refresh_token / expires_in，与现有 OAuth2 刷新模型不兼容。当前 codeup 一律走 PAT
// 模式（identity.AccessToken 存用户填写的 PAT）。等云效放开公网接入并补齐响应字段后，
// 再补 Authorize/Callback handler 和 token 持久化逻辑。
type CodeupOAuthConfig struct {
	ClientID     string `mapstructure:"client_id"`
	ClientSecret string `mapstructure:"client_secret"`
	RedirectURL  string `mapstructure:"redirect_url"`
	// TokenURL 阿里云 OAuth2 token endpoint，默认 https://account.aliyun.com/oauth2/v1/token
	TokenURL string `mapstructure:"token_url"`
	// AuthorizeURL 阿里云 OAuth2 authorize endpoint，默认 https://account.aliyun.com/oauth2/v1/auth
	AuthorizeURL string `mapstructure:"authorize_url"`
}

// CnbConfig 腾讯 CNB (cnb.cool) 配置
type CnbConfig struct {
	// OpenAPI 域名（默认 https://api.cnb.cool）
	BaseURL string `mapstructure:"base_url"`
	// Web 域名（默认 https://cnb.cool，OAuth authorize / token endpoint 走这个）
	WebBaseURL string         `mapstructure:"web_base_url"`
	Enabled    bool           `mapstructure:"enabled"`
	OAuth      CnbOAuthConfig `mapstructure:"oauth"`
}

// CnbOAuthConfig CNB OAuth2 配置（标准授权码模式 + refresh_token）
type CnbOAuthConfig struct {
	ClientID     string `mapstructure:"client_id"`
	ClientSecret string `mapstructure:"client_secret"`
	RedirectURL  string `mapstructure:"redirect_url"`
	// Scope 默认 "repo-basic-info repo-code account-profile"
	Scope string `mapstructure:"scope"`
}

// AtomgitConfig atomgit (https://atomgit.com) 配置
//
// 当前实现仅支持 PAT 模式; OAuth authorize/callback 链路待补 (token endpoint 已在文档中:
// POST https://api.atomgit.com/login/oauth/access_token, refresh_token 也走该地址)。
type AtomgitConfig struct {
	// OpenAPI 域名（默认 https://api.atomgit.com）
	BaseURL string `mapstructure:"base_url"`
	Enabled bool   `mapstructure:"enabled"`
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

// IsCodeupEnabled 检查 Codeup 是否启用
func (c *Config) IsCodeupEnabled() bool {
	return c.Codeup.Enabled
}

// GetCodeupBaseURL 获取 Codeup OpenAPI 域名（默认公共站）
func (c *Config) GetCodeupBaseURL() string {
	if c.Codeup.BaseURL != "" {
		return c.Codeup.BaseURL
	}
	return "https://openapi-rdc.aliyuncs.com"
}

// GetCodeupOAuthClientID 获取 Codeup OAuth Client ID
func (c *Config) GetCodeupOAuthClientID() string {
	return c.Codeup.OAuth.ClientID
}

// GetCodeupOAuthClientSecret 获取 Codeup OAuth Client Secret
func (c *Config) GetCodeupOAuthClientSecret() string {
	return c.Codeup.OAuth.ClientSecret
}

// GetCodeupOAuthRedirectURL 获取 Codeup OAuth Redirect URL
func (c *Config) GetCodeupOAuthRedirectURL() string {
	if c.Codeup.OAuth.RedirectURL != "" {
		return c.Codeup.OAuth.RedirectURL
	}
	return c.Server.BaseURL + "/api/v1/oauth/codeup/callback"
}

// GetCodeupOAuthTokenURL 获取 Codeup OAuth token endpoint（默认阿里云账号通用网关）
func (c *Config) GetCodeupOAuthTokenURL() string {
	if c.Codeup.OAuth.TokenURL != "" {
		return c.Codeup.OAuth.TokenURL
	}
	return "https://account.aliyun.com/oauth2/v1/token"
}

// GetCodeupOAuthAuthorizeURL 获取 Codeup OAuth authorize endpoint
func (c *Config) GetCodeupOAuthAuthorizeURL() string {
	if c.Codeup.OAuth.AuthorizeURL != "" {
		return c.Codeup.OAuth.AuthorizeURL
	}
	return "https://account.aliyun.com/oauth2/v1/auth"
}

// IsCnbEnabled 检查 CNB 是否启用
func (c *Config) IsCnbEnabled() bool {
	return c.Cnb.Enabled
}

// GetCnbBaseURL 获取 CNB OpenAPI 域名（默认 https://api.cnb.cool）
func (c *Config) GetCnbBaseURL() string {
	if c.Cnb.BaseURL != "" {
		return c.Cnb.BaseURL
	}
	return "https://api.cnb.cool"
}

// GetCnbWebBaseURL 获取 CNB Web 域名（OAuth authorize/token 走此域名）
func (c *Config) GetCnbWebBaseURL() string {
	if c.Cnb.WebBaseURL != "" {
		return c.Cnb.WebBaseURL
	}
	return "https://cnb.cool"
}

// GetCnbOAuthClientID 获取 CNB OAuth Client ID
func (c *Config) GetCnbOAuthClientID() string {
	return c.Cnb.OAuth.ClientID
}

// GetCnbOAuthClientSecret 获取 CNB OAuth Client Secret
func (c *Config) GetCnbOAuthClientSecret() string {
	return c.Cnb.OAuth.ClientSecret
}

// GetCnbOAuthRedirectURL 获取 CNB OAuth Redirect URL
func (c *Config) GetCnbOAuthRedirectURL() string {
	if c.Cnb.OAuth.RedirectURL != "" {
		return c.Cnb.OAuth.RedirectURL
	}
	return c.Server.BaseURL + "/api/v1/oauth/cnb/callback"
}

// GetCnbOAuthScope 获取 CNB OAuth scope（多 scope 空格分隔）
func (c *Config) GetCnbOAuthScope() string {
	if c.Cnb.OAuth.Scope != "" {
		return c.Cnb.OAuth.Scope
	}
	return "repo-basic-info repo-code account-profile"
}

// IsAtomgitEnabled 检查 atomgit 是否启用
func (c *Config) IsAtomgitEnabled() bool {
	return c.Atomgit.Enabled
}

// GetAtomgitBaseURL 获取 atomgit OpenAPI 域名（默认 https://api.atomgit.com）
func (c *Config) GetAtomgitBaseURL() string {
	if c.Atomgit.BaseURL != "" {
		return c.Atomgit.BaseURL
	}
	return "https://api.atomgit.com"
}

// WechatConfig 微信配置（包含开放平台和公众号两部分）
type WechatConfig struct {
	Open WechatOpenConfig `mapstructure:"open"`
	MP   WechatMPConfig   `mapstructure:"mp"`
}

// WechatOpenConfig 微信开放平台配置 - 用于网站扫码登录
type WechatOpenConfig struct {
	AppID       string `mapstructure:"app_id"`
	AppSecret   string `mapstructure:"app_secret"`
	CallbackURL string `mapstructure:"callback_url"`
	Scope       string `mapstructure:"scope"`
	Debug       bool   `mapstructure:"debug"`
}

// WechatMPConfig 微信公众号配置 - 用于消息推送
type WechatMPConfig struct {
	AppID          string            `mapstructure:"app_id"`
	AppSecret      string            `mapstructure:"app_secret"`
	Token          string            `mapstructure:"token"`
	EncodingAESKey string            `mapstructure:"encoding_aes_key"`
	Templates      map[string]string `mapstructure:"templates"`
	MirrorMode     bool              `mapstructure:"mirror_mode"`
}
