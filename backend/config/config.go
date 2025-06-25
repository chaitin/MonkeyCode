package config

import (
	_ "embed"

	"github.com/spf13/viper"

	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/logger"
)

//go:embed config.json.tmpl
var ConfigTmpl []byte

type Config struct {
	Debug bool `mapstructure:"debug"`

	Logger *logger.Config `mapstructure:"logger"`

	BaseUrl string `mapstructure:"base_url"`

	Server struct {
		Http struct {
			Host string `mapstructure:"host"`
		} `mapstructure:"http"`
	} `mapstructure:"server"`

	Admin struct {
		User     string `mapstructure:"user"`
		Password string `mapstructure:"password"`
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
		Timeout        string `mapstructure:"timeout"`
		KeepAlive      string `mapstructure:"keep_alive"`
		ClientPoolSize int    `mapstructure:"client_pool_size"`
		RequestLogPath string `mapstructure:"request_log_path"`
	} `mapstructure:"llm_proxy"`

	VSCode struct {
		VSIXFile string `mapstructure:"vsix_file"`
	} `mapstructure:"vscode"`
}

func Init(dir string) (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(dir)
	if err := viper.ReadInConfig(); err != nil {
		return nil, err
	}

	c := Config{}
	if err := viper.Unmarshal(&c); err != nil {
		return nil, err
	}

	c = defaultValue(c)
	return &c, nil
}

func defaultValue(c Config) Config {
	c.Server.Http.Host = cvt.ZeroWithDefault(c.Server.Http.Host, ":8888")
	c.Redis.IdleConn = cvt.ZeroWithDefault(c.Redis.IdleConn, 20)
	c.Database.MaxOpenConns = cvt.ZeroWithDefault(c.Database.MaxOpenConns, 50)
	c.Database.MaxIdleConns = cvt.ZeroWithDefault(c.Database.MaxIdleConns, 10)
	c.Database.ConnMaxLifetime = cvt.ZeroWithDefault(c.Database.ConnMaxLifetime, 30)
	c.Session.ExpireDay = cvt.ZeroWithDefault(c.Session.ExpireDay, 15)

	c.LLMProxy.Timeout = cvt.ZeroWithDefault(c.LLMProxy.Timeout, "30s")
	c.LLMProxy.KeepAlive = cvt.ZeroWithDefault(c.LLMProxy.KeepAlive, "60s")
	c.LLMProxy.ClientPoolSize = cvt.ZeroWithDefault(c.LLMProxy.ClientPoolSize, 100)
	c.LLMProxy.RequestLogPath = cvt.ZeroWithDefault(c.LLMProxy.RequestLogPath, "/app/request/logs")

	return c
}
