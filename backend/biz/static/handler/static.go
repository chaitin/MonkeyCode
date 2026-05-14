package handler

import (
	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
)

type StaticHandler struct {
}

func NewStaticHandler(i *do.Injector) (*StaticHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	cfg := do.MustInvoke[*config.Config](i)

	s := &StaticHandler{}

	w.Echo().Static(cfg.StaticFiles.RoutePrefix, cfg.StaticFiles.Dir)
	return s, nil
}
