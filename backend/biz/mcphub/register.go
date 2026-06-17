package mcphub

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/auth"
	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/billing"
	mcpsyncer "github.com/chaitin/MonkeyCode/backend/biz/mcphub/control/syncer"
	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/runtime/gateway"
	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/runtime/registry"
	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/runtime/upstreamclient"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
)

type Syncer interface {
	Sync(ctx context.Context, upstreamID uuid.UUID) error
}

type Handler struct {
	web     *web.Web
	config  *config.Config
	gateway http.Handler
	syncer  Syncer
}

type syncReq struct {
	ID string `param:"id"`
}

func ProvideMCPHub(i *do.Injector) {
	do.Provide(i, NewHandlerFromInjector)
}

func InvokeMCPHub(i *do.Injector) {
	do.MustInvoke[*Handler](i)
}

func NewHandler(w *web.Web, cfg *config.Config, gateway http.Handler, syncer Syncer) *Handler {
	return &Handler{
		web:     w,
		config:  cfg,
		gateway: gateway,
		syncer:  syncer,
	}
}

func NewHandlerFromInjector(i *do.Injector) (*Handler, error) {
	w := do.MustInvoke[*web.Web](i)
	cfg := do.MustInvoke[*config.Config](i)
	client := do.MustInvoke[*db.Client](i)
	logger := resolveLogger(i)

	upstreams := repo.NewUpstreamRepo(client)
	tools := repo.NewToolRepo(client)
	userSettings := repo.NewUserToolSettingRepo(client)
	calls := repo.NewToolCallRepo(client)
	authSvc := auth.NewService(client, logger)
	billingSvc := billing.NewNoop()
	upstreamHTTP := upstreamclient.NewHTTPClient(cfg.MCPHub.UpstreamTimeoutDuration())

	var rdb redis.Cmdable
	if redisClient, err := do.Invoke[*redis.Client](i); err == nil {
		rdb = redisClient
	}
	registrySvc := registry.NewService(rdb, tools, userSettings)
	syncerSvc := mcpsyncer.NewService(upstreams, tools, registrySvc, upstreamHTTP)
	gatewayHandler := gateway.NewHandler(
		registrySvc,
		gateway.WithAuthResolver(authSvc),
		gateway.WithToolCallStore(calls),
		gateway.WithUpstreamRepo(upstreams),
		gateway.WithUpstreamCaller(upstreamHTTP),
		gateway.WithBillingConsumer(billingSvc),
		gateway.WithLogger(logger),
	)

	h := NewHandler(w, cfg, gatewayHandler, syncerSvc)
	h.RegisterRoutes()
	return h, nil
}

func (h *Handler) RegisterRoutes() {
	mcpHandler := web.BaseHandler(func(c *web.Context) error {
		h.gateway.ServeHTTP(c.Response(), c.Request())
		return nil
	})
	g := h.web.Group("/mcp")
	g.GET("", mcpHandler)
	g.POST("", mcpHandler)
	g.DELETE("", mcpHandler)

	h.web.POST("/internal/upstreams/:id/sync", web.BindHandler(h.SyncUpstream))
}

func (h *Handler) SyncUpstream(c *web.Context, req syncReq) error {
	token, ok := strings.CutPrefix(c.Request().Header.Get("Authorization"), "Bearer ")
	if !ok || strings.TrimSpace(token) != h.config.MCPHub.Token || strings.TrimSpace(token) == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{"message": "unauthorized"})
	}

	upstreamID, err := uuid.Parse(req.ID)
	if err != nil {
		return err
	}
	if err := h.syncer.Sync(c.Request().Context(), upstreamID); err != nil {
		return err
	}
	return c.Success(nil)
}

func resolveLogger(i *do.Injector) *slog.Logger {
	logger, err := do.Invoke[*slog.Logger](i)
	if err == nil && logger != nil {
		return logger
	}
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
