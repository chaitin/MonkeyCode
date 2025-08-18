package config

import (
	_ "embed"
	"fmt"
	"net/http"
	"strings"

	"github.com/spf13/viper"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/logger"
)

//go:embed config.json.tmpl
var ConfigTmpl []byte

type Config struct {
	Debug bool `mapstructure:"debug"`

	ReadOnly bool `mapstructure:"read_only"`

	Logger *logger.Config `mapstructure:"logger"`

	Server struct {
		Addr string `mapstructure:"addr"`
		Port string `mapstructure:"port"`
	} `mapstructure:"server"`

	Admin struct {
		User     string `mapstructure:"user"`
		Password string `mapstructure:"password"`
		Limit    int    `mapstructure:"limit"`
	} `mapstructure:"admin"`

	Session struct {
		ExpireDay int `mapstructure:"expire_day"`
	} `mapstructure:"session"`

	Database struct {
		Master          string `mapstructure:"master"`
		Slave           string `mapstructure:"slave"`
		MaxOpenConns    int    `mapstructure:"max_open_conns"`
		MaxIdleConns    int    `mapstructure:"max_idle_conns"`
		ConnMaxLifetime int    `mapstructure:"conn_max_lifetime"`
	} `mapstructure:"database"`

	Redis struct {
		Host     string `mapstructure:"host"`
		Port     string `mapstructure:"port"`
		Pass     string `mapstructure:"pass"`
		DB       int    `mapstructure:"db"`
		IdleConn int    `mapstructure:"idle_conn"`
	} `mapstructure:"redis"`

	LLMProxy struct {
		Timeout              string `mapstructure:"timeout"`
		KeepAlive            string `mapstructure:"keep_alive"`
		ClientPoolSize       int    `mapstructure:"client_pool_size"`
		StreamClientPoolSize int    `mapstructure:"stream_client_pool_size"`
		RequestLogPath       string `mapstructure:"request_log_path"`
	} `mapstructure:"llm_proxy"`

	InitModel struct {
		Name string `mapstructure:"name"`
		Key  string `mapstructure:"key"`
		URL  string `mapstructure:"url"`
	} `mapstructure:"init_model"`

	Embedding struct {
		ModelName   string `mapstructure:"model_name"`
		APIEndpoint string `mapstructure:"api_endpoint"`
		APIKey      string `mapstructure:"api_key"`
	} `mapstructure:"embedding"`

	Extension struct {
		Baseurl     string `mapstructure:"baseurl"`
		LimitSecond int    `mapstructure:"limit_second"`
		Limit       int    `mapstructure:"limit"`
	} `mapstructure:"extension"`

	DataReport struct {
		Key           string `mapstructure:"key"`
		MachineIDFile string `mapstructure:"machine_id_file"`
	} `mapstructure:"data_report"`

	Security struct {
		QueueLimit int `mapstructure:"queue_limit"`
	} `mapstructure:"security"`
}

func (c *Config) GetBaseURL(req *http.Request, settings *domain.Setting) string {
	scheme := "http"
	if req.TLS != nil {
		scheme = "https"
	}
	if proto := req.Header.Get("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	}

	if settings != nil && settings.BaseURL != "" {
		baseurl := settings.BaseURL
		if !strings.HasPrefix(baseurl, "http") {
			baseurl = fmt.Sprintf("%s://%s", scheme, baseurl)
		}
		return strings.TrimSuffix(baseurl, "/")
	}

	if port := req.Header.Get("X-Forwarded-Port"); port != "" && port != "80" && port != "443" {
		c.Server.Port = port
	}
	baseurl := fmt.Sprintf("%s://%s", scheme, req.Host)
	if c.Server.Port != "" {
		baseurl = fmt.Sprintf("%s:%s", baseurl, c.Server.Port)
	}
	return baseurl
}

func Init() (*Config, error) {
	v := viper.New()
	v.AutomaticEnv()
	v.SetEnvPrefix("MONKEYCODE")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	// 可选的配置文件读取（保持向后兼容）
	// 优先级：环境变量 > 配置文件 > 默认值
	v.SetConfigType("yaml")
	v.AddConfigPath("./config")
	v.AddConfigPath(".")

	// 尝试读取本地开发配置（仅用于开发环境便利性）
	v.SetConfigName("config.local")
	if err := v.ReadInConfig(); err != nil {
		// 本地配置不存在是正常的，不需要报错
		// 线上部署完全依赖环境变量，这样保持向后兼容
	}

	// 设置默认值，确保在没有配置文件时程序能启动（云上部署场景）
	v.SetDefault("debug", false)
	v.SetDefault("read_only", false)
	v.SetDefault("logger.level", "info")
	v.SetDefault("server.addr", ":8888")
	v.SetDefault("server.port", "")
	v.SetDefault("admin.user", "admin")
	v.SetDefault("admin.password", "")
	v.SetDefault("admin.limit", 100)
	v.SetDefault("session.expire_day", 30)
	v.SetDefault("database.master", "")
	v.SetDefault("database.slave", "")
	v.SetDefault("database.max_open_conns", 50)
	v.SetDefault("database.max_idle_conns", 10)
	v.SetDefault("database.conn_max_lifetime", 30)
	v.SetDefault("redis.host", "monkeycode-redis")
	v.SetDefault("redis.port", "6379")
	v.SetDefault("redis.pass", "")
	v.SetDefault("redis.db", 0)
	v.SetDefault("redis.idle_conn", 20)
	v.SetDefault("llm_proxy.timeout", "30s")
	v.SetDefault("llm_proxy.keep_alive", "60s")
	v.SetDefault("llm_proxy.client_pool_size", 100)
	v.SetDefault("llm_proxy.stream_client_pool_size", 5000)
	v.SetDefault("llm_proxy.request_log_path", "/app/request/logs")
	v.SetDefault("init_model.name", "")
	v.SetDefault("init_model.key", "")
	v.SetDefault("init_model.url", "")
	v.SetDefault("extension.baseurl", "https://release.baizhi.cloud")
	v.SetDefault("extension.limit", 1)
	v.SetDefault("extension.limit_second", 10)
	v.SetDefault("data_report.key", "")
	v.SetDefault("data_report.machine_id_file", "static/.machine_id")
	v.SetDefault("security.queue_limit", 5)
	v.SetDefault("embedding.model_name", "qwen3-embedding-0.6b")
	v.SetDefault("embedding.api_endpoint", "https://aiapi.chaitin.net/v1/embeddings")
	v.SetDefault("embedding.api_key", "")

	c := Config{}
	if err := v.Unmarshal(&c); err != nil {
		return nil, err
	}

	return &c, nil
}
