package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	_ "net/http/pprof"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/agentconfig"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/apikey"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/database"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/expert"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/group"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/httpapi"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rule"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/setting"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/skill"
)

type App struct {
	servers         []*http.Server
	database        *pgxpool.Pool
	shutdownTimeout time.Duration
	billing         *billing.Service
	proxy           *proxy.Proxy
}

func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*App, error) {
	pool, err := database.Open(ctx, cfg.URL)
	if err != nil {
		return nil, err
	}
	handler, err := newApplicationHandler(ctx, logger, pool, cfg)
	if err != nil {
		pool.Close()
		return nil, err
	}

	return &App{
		servers: []*http.Server{
			{
				Addr:              cfg.Addr,
				Handler:           handler,
				ReadHeaderTimeout: 5 * time.Second,
				IdleTimeout:       2 * time.Minute,
				MaxHeaderBytes:    1 << 20,
				ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
			},
			{
				Addr:              cfg.PprofAddr,
				Handler:           http.DefaultServeMux,
				ReadHeaderTimeout: 5 * time.Second,
				IdleTimeout:       2 * time.Minute,
				MaxHeaderBytes:    1 << 20,
				ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
			},
		},
		billing:         handler.(*applicationHandler).billing,
		proxy:           handler.(*applicationHandler).proxy,
		database:        pool,
		shutdownTimeout: cfg.ShutdownTimeout,
	}, nil
}

func newHandler(logger *slog.Logger, database httpapi.Pinger) http.Handler {
	admin := chi.NewRouter()
	agent := chi.NewRouter()
	auth := chi.NewRouter()
	router := chi.NewRouter()
	proxy.NewProxy(nil, logger).Register(router)
	router.Mount("/", httpapi.New(logger, database, admin, agent, auth))
	return router
}

func newApplicationHandler(ctx context.Context, logger *slog.Logger, pool *pgxpool.Pool, cfg config.Config) (http.Handler, error) {
	settings := setting.NewService(setting.NewPostgres(pool))
	identities := identity.NewService(pool, settings, cfg.PublicURL, cfg.AdminURL)
	if err := identities.EnsureInitialAdmin(ctx, cfg.InitialAdminName, cfg.InitialAdminEmail, cfg.InitialAdminPassword); err != nil {
		return nil, fmt.Errorf("初始化管理员: %w", err)
	}
	wallet, err := billing.WalletFromEnv()
	if err != nil {
		return nil, fmt.Errorf("初始化远程计费: %w", err)
	}
	charges := billing.NewService(pool).WithWallet(wallet)
	if err = charges.Initialize(ctx); err != nil {
		return nil, fmt.Errorf("初始化计费: %w", err)
	}
	identities.WithAccountPreserver(charges)
	keys := apikey.NewService(apikey.NewPostgres(pool))
	modelRepo := model.NewPostgres(pool)
	models := model.NewService(modelRepo).WithKeyAuthenticator(keys)
	storage, err := resource.NewS3(ctx)
	if err != nil {
		return nil, err
	}
	initCtx, cancel := context.WithTimeout(ctx, time.Minute)
	err = storage.Init(initCtx)
	cancel()
	if err != nil {
		return nil, fmt.Errorf("初始化资源 Bucket: %w", err)
	}
	store := resource.NewStore(pool)
	rules := rule.NewService(store)
	skills := skill.NewService(store, storage)
	connectors := mcp.NewService(store, cfg.PublicURL).WithStorage(storage)
	experts := expert.NewService(store)
	resources := agentconfig.NewResources(store, connectors, skills)
	agentConfig := agentconfig.NewService(settings, models, cfg.PublicURL).WithResources(resources)

	admin := chi.NewRouter()
	admin.Use(identities.RequireAdmin)
	identities.RegisterAdmin(admin)
	group.NewService(pool).WithAccountPreserver(charges).RegisterAdmin(admin)
	settings.RegisterAdmin(admin)
	charges.RegisterAdmin(admin)
	keys.RegisterAdmin(admin)
	models.RegisterAdmin(admin)
	store.RegisterAdmin(admin)
	store.RegisterGrants(admin, map[string]*resource.CRUD{"rule": rules, "skill": skills.CRUD, "expert": experts.CRUD, "connector": connectors.Connectors})
	rules.Register(admin)
	skills.RegisterAdmin(admin)
	connectors.RegisterAdmin(admin)
	experts.RegisterAdmin(admin)
	resources.RegisterAdmin(admin)

	agent := chi.NewRouter()
	agent.Use(identities.RequireAgent)
	identities.RegisterAgent(agent)
	keys.RegisterAgent(agent)
	models.RegisterAgent(agent)
	store.RegisterSharing(agent, map[string]resource.Shareable{"model": modelRepo})
	agentConfig.RegisterAgent(agent)
	connectors.RegisterAgent(agent)
	resources.RegisterAgent(agent)
	charges.RegisterAgent(agent)

	router := chi.NewRouter()
	modelProxy := proxy.NewProxy(modelResolver{service: models}, logger).WithBilling(modelBilling{service: charges})
	modelProxy.Register(router)
	connectors.RegisterGateway(router, keys, toolBilling{service: charges})
	router.Get("/.well-known/oauth-authorization-server", identities.OAuthMetadata)
	router.Get("/oauth/connectors/callback", connectors.Callback)
	router.Mount("/oauth", identities.OAuthRouter())
	router.Mount("/", httpapi.New(logger, readiness{pool: pool, storage: storage}, admin, agent, identities.AuthRouter()))
	return &applicationHandler{Handler: router, billing: charges, proxy: modelProxy}, nil
}

type modelResolver struct {
	service *model.Service
}

func (r modelResolver) Resolve(ctx context.Context, credential, requestedModel string) (proxy.Target, error) {
	target, err := r.service.Resolve(ctx, credential, requestedModel)
	if err != nil {
		return proxy.Target{}, err
	}
	return proxy.Target{
		ModelID:       target.ID,
		UpstreamModel: target.UpstreamModelID,
		Protocol:      string(target.Protocol),
		UserID:        target.UserID,
		BaseURL:       target.BaseURL,
		APIKey:        target.APIKey,
	}, nil
}

func (a *App) Run(ctx context.Context) error {
	defer a.database.Close()
	workerCtx, stopWorker := context.WithCancel(context.Background())
	workerDone := make(chan struct{})
	go func() { defer close(workerDone); a.billing.Run(workerCtx) }()
	defer func() { stopWorker(); <-workerDone }()

	result := make(chan error, len(a.servers))
	for _, server := range a.servers {
		go func() {
			err := server.ListenAndServe()
			if errors.Is(err, http.ErrServerClosed) {
				err = nil
			} else if err != nil {
				err = fmt.Errorf("监听 %s: %w", server.Addr, err)
			}
			result <- err
		}()
	}

	completed := 0
	var runErrors []error
	select {
	case err := <-result:
		runErrors = append(runErrors, err)
		completed++
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), a.shutdownTimeout)
	defer cancel()
	for _, server := range a.servers {
		if err := server.Shutdown(shutdownCtx); err != nil {
			runErrors = append(runErrors, fmt.Errorf("关闭 %s: %w", server.Addr, err))
		}
	}

	if err := a.proxy.Wait(shutdownCtx); err != nil {
		runErrors = append(runErrors, err)
	}
	for completed < len(a.servers) {
		runErrors = append(runErrors, <-result)
		completed++
	}
	return errors.Join(runErrors...)
}

type readiness struct {
	pool    *pgxpool.Pool
	storage resource.Storage
}

func (r readiness) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := r.pool.Ping(ctx); err != nil {
		return err
	}
	return r.storage.Ping(ctx)
}
