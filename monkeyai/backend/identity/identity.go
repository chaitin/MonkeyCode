package identity

import (
	"context"
	core "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
)

type User = core.User
type Service = core.Service
type SettingReader = core.SettingReader

func UserFromContext(ctx context.Context) (User, bool)          { return core.UserFromContext(ctx) }
func RequireScope(scope string) func(http.Handler) http.Handler { return core.RequireScope(scope) }
func NewService(pool *pgxpool.Pool, settings SettingReader, publicURL string) *Service {
	return core.NewService(pool, settings, publicURL)
}
