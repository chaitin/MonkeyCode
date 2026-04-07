package middleware

import (
	"log/slog"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

// TargetActiveMiddleware 用户活动时间追踪中间件
type TargetActiveMiddleware struct {
	logger     *slog.Logger
	activeRepo domain.UserActiveRepo
}

// NewTargetActiveMiddleware 创建用户活动时间追踪中间件
func NewTargetActiveMiddleware(logger *slog.Logger, activeRepo domain.UserActiveRepo) *TargetActiveMiddleware {
	return &TargetActiveMiddleware{
		logger:     logger.With("module", "middleware.target_active"),
		activeRepo: activeRepo,
	}
}

// TargetActive 记录用户活动时间
func (t *TargetActiveMiddleware) TargetActive() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ctx := c.Request().Context()
			user := GetUser(c)

			if user != nil && t.activeRepo != nil {
				if err := t.activeRepo.RecordActiveRecord(
					ctx,
					consts.UserActiveKey,
					user.ID.String(),
					time.Now(),
				); err != nil {
					t.logger.WarnContext(ctx, "failed to record user active time", "error", err, "user_id", user.ID)
				}
			}
			return next(c)
		}
	}
}
