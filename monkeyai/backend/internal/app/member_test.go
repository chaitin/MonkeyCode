package app

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/testmember"
	"github.com/jackc/pgx/v5/pgxpool"
)

func newMemberTestHandler(ctx context.Context, logger *slog.Logger, pool *pgxpool.Pool, cfg config.Config) (http.Handler, error) {
	return newApplicationHandlerWithMembers(ctx, logger, pool, cfg, testmember.Users(pool), testmember.Groups(), nil)
}
