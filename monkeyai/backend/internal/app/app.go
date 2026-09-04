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
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
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

	return &App{
		servers: []*http.Server{
			{
				Addr:              cfg.Addr,
				Handler:           newHandler(logger, pool),
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
	router := chi.NewRouter()
	proxy.NewProxy(nil, logger).Register(router)
	router.Mount("/", httpapi.New(logger, database, admin, agent))
	return router
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
