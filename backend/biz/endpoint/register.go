package endpoint

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

func ProvideEndpoint(i *do.Injector) {
	do.Provide(i, func(i *do.Injector) (*Bridge, error) {
		bridge := newBridge(
			do.MustInvoke[*db.Client](i),
			do.MustInvoke[*redis.Client](i),
			do.MustInvoke[*config.Config](i),
			do.MustInvoke[*slog.Logger](i),
		)
		bridge.Register(
			do.MustInvoke[*web.Web](i),
			do.MustInvoke[*middleware.AuthMiddleware](i),
		)
		return bridge, nil
	})
}

func InvokeEndpoint(i *do.Injector) {
	do.MustInvoke[*Bridge](i)
}
