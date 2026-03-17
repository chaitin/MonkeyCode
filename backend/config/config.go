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

	RootPath   string         `mapstructure:"root_path"`
	Logger     *logger.Config `mapstructure:"logger"`
	AdminToken string         `mapstructure:"admin_token"`
	Proxies    []string       `mapstructure:"proxies"`

	TaskFlow   TaskFlow   `mapstructure:"taskflow"`
	PublicHost PublicHost `mapstructure:"public_host"`
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

type Session struct {
	ExpireDay int `mapstructure:"expire_day"`
}

type SMTP struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Username string `mapstructure:"username"`
	Password string `mapstructure:"password"`
	From     string `mapstructure:"from"`
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
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	v.SetDefault("debug", true)
	v.SetDefault("server.addr", ":8888")
	v.SetDefault("server.base_url", "http://localhost:8888")
	v.SetDefault("database.max_open_conns", 100)
	v.SetDefault("database.max_idle_conns", 50)
	v.SetDefault("database.conn_max_lifetime", 30)
	v.SetDefault("root_path", "/app")
	v.SetDefault("logger.level", "info")
	v.SetDefault("session.expire_day", 1)
	v.SetDefault("smtp.port", 587)

	v.SetConfigType("yaml")
	v.AddConfigPath(dir)
	v.SetConfigName("config")
	if err := v.ReadInConfig(); err != nil {
		return nil, err
	}

	c := Config{}
	if err := v.Unmarshal(&c); err != nil {
		return nil, err
	}

	return &c, nil
}
