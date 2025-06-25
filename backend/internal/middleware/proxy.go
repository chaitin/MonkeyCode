package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/logger"
)

const (
	ApiContextKey = "session:apikey"
)

type ProxyMiddleware struct {
	usecase domain.ProxyUsecase
}

func NewProxyMiddleware(
	usecase domain.ProxyUsecase,
) *ProxyMiddleware {
	return &ProxyMiddleware{
		usecase: usecase,
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

			key, err := p.usecase.ValidateApiKey(c.Request().Context(), apiKey)
			if err != nil {
				return c.JSON(http.StatusUnauthorized, echo.Map{"error": "Unauthorized"})
			}

			ctx := c.Request().Context()
			ctx = context.WithValue(ctx, logger.UserIDKey, key.UserID)
			c.SetRequest(c.Request().WithContext(ctx))
			c.Set(ApiContextKey, key)
			return next(c)
		}
	}
}

func GetApiKey(c echo.Context) *domain.ApiKey {
	return c.Get(ApiContextKey).(*domain.ApiKey)
}
