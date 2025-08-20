package middleware

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/ent/rule"
	"github.com/chaitin/MonkeyCode/backend/pkg/session"
)

const (
	adminKey = "session:admin"
	userKey  = "session:user"
)

type AuthMiddleware struct {
	usecase domain.UserUsecase
	session *session.Session
	logger  *slog.Logger
}

func NewAuthMiddleware(
	usecase domain.UserUsecase,
	session *session.Session,
	logger *slog.Logger,
) *AuthMiddleware {
	return &AuthMiddleware{
		usecase: usecase,
		session: session,
		logger:  logger,
	}
}

func (m *AuthMiddleware) UserAuth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			user, err := session.Get[domain.User](m.session, c, consts.UserSessionName)
			if err != nil {
				m.logger.Error("auth failed", "error", err)
				return c.String(http.StatusUnauthorized, "Unauthorized")
			}
			c.Set(userKey, &user)
			ctx := rule.SkipPermission(c.Request().Context())
			c.SetRequest(c.Request().WithContext(ctx))
			return next(c)
		}
	}
}

func (m *AuthMiddleware) Auth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			admin, err := session.Get[domain.AdminUser](m.session, c, consts.SessionName)
			if err != nil {
				m.logger.Error("auth failed", "error", err)
				return c.String(http.StatusUnauthorized, "Unauthorized")
			}
			c.Set(adminKey, &admin)
			if permissions, err := m.usecase.GetPermissions(c.Request().Context(), admin.ID); err == nil {
				ctx := context.WithValue(c.Request().Context(), rule.PermissionKey{}, permissions)
				c.SetRequest(c.Request().WithContext(ctx))
			} else {
				ctx := context.WithValue(c.Request().Context(), rule.PermissionKey{}, &domain.Permissions{
					AdminID: admin.ID,
					IsAdmin: admin.IsAdmin(),
				})
				c.SetRequest(c.Request().WithContext(ctx))
			}
			return next(c)
		}
	}
}

func GetAdmin(c echo.Context) *domain.AdminUser {
	i := c.Get(adminKey)
	if i == nil {
		return nil
	}
	return i.(*domain.AdminUser)
}

func GetUser(c echo.Context) *domain.User {
	i := c.Get(userKey)
	if i == nil {
		return nil
	}
	return i.(*domain.User)
}
