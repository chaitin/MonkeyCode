package middleware

import (
	"context"

	"github.com/google/uuid"

	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/backend/pkg/logger"
)

func RequestID() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ctx := c.Request().Context()
			requestID := uuid.New().String()
			ctx = context.WithValue(ctx, logger.RequestIDKey, requestID)
			c.SetRequest(c.Request().WithContext(ctx))
			return next(c)
		}
	}
}
