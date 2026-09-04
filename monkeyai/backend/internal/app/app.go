package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/database"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/httpapi"
)

type App struct {
	server          *http.Server
	database        *pgxpool.Pool
	shutdownTimeout time.Duration
}

func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*App, error) {
	pool, err := database.Open(ctx, cfg.URL)
	if err != nil {
		return nil, err
	}
	admin := chi.NewRouter()
	agent := chi.NewRouter()

	return &App{
		server: &http.Server{
			Addr:              cfg.Addr,
			Handler:           httpapi.New(logger, pool, admin, agent),
			ReadHeaderTimeout: 5 * time.Second,
			IdleTimeout:       2 * time.Minute,
			MaxHeaderBytes:    1 << 20,
			ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
		},
		database:        pool,
		shutdownTimeout: cfg.ShutdownTimeout,
	}, nil
}

func (a *App) Run(ctx context.Context) error {
	defer a.database.Close()

	result := make(chan error, 1)
	go func() {
		result <- a.server.ListenAndServe()
	}()

	select {
	case err := <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("运行 HTTP 服务: %w", err)
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), a.shutdownTimeout)
	defer cancel()
	if err := a.server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("关闭 HTTP 服务: %w", err)
	}

	err := <-result
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("运行 HTTP 服务: %w", err)
	}
	return nil
}
