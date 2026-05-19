package llmproxy

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
)

type Handler struct {
	proxy *Proxy
}

func ProvideLLMProxy(i *do.Injector) {
	do.Provide(i, NewHandler)
}

func InvokeLLMProxy(i *do.Injector) {
	do.MustInvoke[*Handler](i)
}

func NewHandler(i *do.Injector) (*Handler, error) {
	w := do.MustInvoke[*web.Web](i)
	client := do.MustInvoke[*db.Client](i)
	logger := do.MustInvoke[*slog.Logger](i)

	h := &Handler{proxy: NewProxy(client, logger)}
	g := w.Group("/v1")
	g.POST("/chat/completions", web.BaseHandler(h.ServeHTTP))
	g.POST("/responses", web.BaseHandler(h.ServeHTTP))
	g.POST("/messages", web.BaseHandler(h.ServeHTTP))
	return h, nil
}

func (h *Handler) ServeHTTP(c *web.Context) error {
	h.proxy.ServeHTTP(c.Response(), c.Request())
	return nil
}
