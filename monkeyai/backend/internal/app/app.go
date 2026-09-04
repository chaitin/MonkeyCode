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

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/database"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/httpapi"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/setting"
)

type App struct {
	servers         []*http.Server
	database        *pgxpool.Pool
	shutdownTimeout time.Duration
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
	broker := setting.NewBroker()
	settings := setting.NewService(setting.NewPostgres(pool), broker)
	identities := identity.NewService(pool, settings, cfg.PublicURL, cfg.AdminURL)
	if err := identities.EnsureInitialAdmin(ctx, cfg.InitialAdminName, cfg.InitialAdminEmail, cfg.InitialAdminPassword); err != nil {
		return nil, fmt.Errorf("初始化管理员: %w", err)
	}
	go func() {
		for ctx.Err() == nil {
			if err := settings.Listen(ctx); err != nil && ctx.Err() == nil {
				logger.Error("监听设置变更失败", "error", err)
			}
			select {
			case <-ctx.Done():
			case <-time.After(time.Second):
			}
		}
	}()

	admin := chi.NewRouter()
	admin.Use(identities.RequireAdmin)
	identities.RegisterAdmin(admin)
	settings.RegisterAdmin(admin)

	agent := chi.NewRouter()
	agent.Use(identities.RequireAgent)
	identities.RegisterAgent(agent)
	settings.RegisterAgent(agent)

	router := chi.NewRouter()
	proxy.NewProxy(nil, logger).Register(router)
	router.Get("/.well-known/oauth-authorization-server", identities.OAuthMetadata)
	router.Mount("/oauth", identities.OAuthRouter())
	router.Mount("/", httpapi.New(logger, pool, admin, agent, identities.AuthRouter()))
	return router, nil
}

func (a *App) Run(ctx context.Context) error {
	defer a.database.Close()

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

	for completed < len(a.servers) {
		runErrors = append(runErrors, <-result)
		completed++
	}
	return errors.Join(runErrors...)
}
