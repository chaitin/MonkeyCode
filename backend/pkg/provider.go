package pkg

import (
	"github.com/google/wire"
	"github.com/labstack/echo/v4/middleware"
	"golang.org/x/text/language"

	"github.com/GoYoko/web"
	"github.com/GoYoko/web/locale"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	mid "github.com/chaitin/MonkeyCode/backend/internal/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/ipdb"
	"github.com/chaitin/MonkeyCode/backend/pkg/logger"
	"github.com/chaitin/MonkeyCode/backend/pkg/report"
	"github.com/chaitin/MonkeyCode/backend/pkg/session"
	"github.com/chaitin/MonkeyCode/backend/pkg/store"
	"github.com/chaitin/MonkeyCode/backend/pkg/version"
)

var Provider = wire.NewSet(
	NewWeb,
	logger.NewLogger,
	store.NewEntDB,
	store.NewRedisCli,
	session.NewSession,
	ipdb.NewIPDB,
	report.NewReport,
	version.NewVersionInfo,
)

func NewWeb(cfg *config.Config) *web.Web {
	w := web.New()
	l := locale.NewLocalizerWithFile(language.Chinese, errcode.LocalFS, []string{"locale.zh.toml"})
	w.SetLocale(l)
	w.Use(mid.RequestID())
	if cfg.Debug {
		w.Use(middleware.Logger())
	}
	return w
}
