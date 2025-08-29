package middleware

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/ent/rule"
	"github.com/chaitin/MonkeyCode/backend/pkg/logger"
)

const (
	ApiContextKey = "session:apikey"
)

type proxyModelKey struct{}

type ProxyMiddleware struct {
	usecase domain.ProxyUsecase
	redis   *redis.Client
	logger  *slog.Logger
}

func NewProxyMiddleware(
	usecase domain.ProxyUsecase,
	redis *redis.Client,
	logger *slog.Logger,
) *ProxyMiddleware {
	return &ProxyMiddleware{
		usecase: usecase,
		redis:   redis,
		logger:  logger.With("module", "ProxyMiddleware"),
	}
}

func (p *ProxyMiddleware) Auth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			apiKey := c.Request().Header.Get("X-API-Key")
			if apiKey == "" {
				apiKey = strings.TrimPrefix(c.Request().Header.Get("Authorization"), "Bearer ")
			}
			if apiKey == "" {
				return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
			}

			ctx := c.Request().Context()
			p.logger.With("apiKey", apiKey).DebugContext(ctx, "v1 auth")
			if strings.Contains(apiKey, ".") {
				s, err := p.redis.Get(ctx, apiKey).Result()
				if err != nil {
					p.logger.With("fn", "Auth").With("error", err).ErrorContext(ctx, "failed to get api key from redis")
					return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
				}
				var model *domain.Model
				if err := json.Unmarshal([]byte(s), &model); err != nil {
					p.logger.With("fn", "Auth").With("error", err).ErrorContext(ctx, "failed to unmarshal model from redis")
					return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
				}
				parts := strings.Split(apiKey, ".")
				if len(parts) != 2 {
					p.logger.With("fn", "Auth").With("apiKey", apiKey).ErrorContext(ctx, "invalid api key")
					return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
				}
				ctx = context.WithValue(ctx, proxyModelKey{}, model)
				ctx = context.WithValue(ctx, logger.UserIDKey{}, parts[0])
				c.Set(ApiContextKey, &domain.ApiKey{
					UserID: parts[0],
					Key:    apiKey,
				})
			} else {
				key, err := p.usecase.ValidateApiKey(ctx, apiKey)
				if err != nil {
					return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
				}
				ctx = context.WithValue(ctx, logger.UserIDKey{}, key.UserID)
				c.Set(ApiContextKey, key)
			}

			ctx = rule.SkipPermission(ctx)
			c.SetRequest(c.Request().WithContext(ctx))
			return next(c)
		}
	}
}

func GetProxyModel(ctx context.Context) *domain.Model {
	m := ctx.Value(proxyModelKey{})
	if m == nil {
		return nil
	}
	return m.(*domain.Model)
}

func GetApiKey(c echo.Context) *domain.ApiKey {
	i := c.Get(ApiContextKey)
	if i == nil {
		return nil
	}
	return i.(*domain.ApiKey)
}
