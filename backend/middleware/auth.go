package middleware

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/session"
)

const (
	UserContextKey     = "user"
	TeamUserContextKey = "team_user"
)

// GetUser 从上下文中获取用户信息
func GetUser(ctx echo.Context) *domain.User {
	user, ok := ctx.Get(UserContextKey).(*domain.User)
	if !ok {
		return nil
	}
	return user
}

// SetUser 设置用户信息到上下文
func SetUser(ctx echo.Context, user *domain.User) {
	ctx.Set(UserContextKey, user)
}

// GetTeamUser 从上下文中获取团队用户信息
func GetTeamUser(ctx echo.Context) *domain.TeamUser {
	user, ok := ctx.Get(TeamUserContextKey).(*domain.TeamUser)
	if !ok {
		return nil
	}
	return user
}

// SetTeamUser 设置团队用户信息到上下文
func SetTeamUser(ctx echo.Context, user *domain.TeamUser) {
	ctx.Set(TeamUserContextKey, user)
}

// TeamAdminAuth 团队管理员权限中间件，必须在 TeamAuth 之后使用
func TeamAdminAuth(isAdmin func(ctx context.Context, teamID, userID uuid.UUID) bool) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			teamUser := GetTeamUser(c)
			if teamUser == nil || teamUser.User == nil || teamUser.Team == nil {
				return c.String(http.StatusForbidden, "Forbidden")
			}

			if !isAdmin(c.Request().Context(), teamUser.GetTeamID(), teamUser.User.ID) {
				return c.String(http.StatusForbidden, "Forbidden")
			}

			return next(c)
		}
	}
}

// AuthMiddleware 认证中间件管理器
type AuthMiddleware struct {
	Session *session.Session
	usecase domain.UserUsecase
	logger  *slog.Logger
}

// NewAuthMiddleware 创建认证中间件管理器
func NewAuthMiddleware(
	sess *session.Session,
	usecase domain.UserUsecase,
	logger *slog.Logger,
) *AuthMiddleware {
	return &AuthMiddleware{
		Session: sess,
		usecase: usecase,
		logger:  logger.With("module", "AuthMiddleware"),
	}
}

// Auth 强制要求认证
func (a *AuthMiddleware) Auth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ctx := c.Request().Context()

			user, err := session.Get[*domain.User](a.Session, c, consts.MonkeyCodeAISession)
			if err != nil {
				a.logger.DebugContext(ctx, "get user session failed", "error", err)
				return c.String(http.StatusUnauthorized, "Unauthorized")
			}

			if user == nil {
				a.logger.DebugContext(ctx, "no user found, skipping auth")
				return c.String(http.StatusUnauthorized, "Unauthorized")
			}

			SetUser(c, user)
			return next(c)
		}
	}
}

// Check 检查用户是否已认证（不强制要求认证）
func (a *AuthMiddleware) Check() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ctx := c.Request().Context()

			user, err := session.Get[*domain.User](a.Session, c, consts.MonkeyCodeAISession)
			if err != nil {
				a.logger.DebugContext(ctx, "get user session failed", "error", err)
				return next(c)
			}

			if user == nil {
				a.logger.DebugContext(ctx, "no user found, skipping auth")
				return next(c)
			}

			SetUser(c, user)
			return next(c)
		}
	}
}

// TeamAuth 团队认证中间件
func (a *AuthMiddleware) TeamAuth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ctx := c.Request().Context()

			user, err := session.Get[*domain.User](a.Session, c, consts.MonkeyCodeAITeamSession)
			if err != nil {
				a.logger.DebugContext(ctx, "get team session failed", "error", err)
				return c.String(http.StatusUnauthorized, "Unauthorized")
			}

			if user == nil {
				return c.String(http.StatusUnauthorized, "Unauthorized")
			}

			if user.Team == nil {
				return c.String(http.StatusUnauthorized, "User has no team")
			}

			SetTeamUser(c, &domain.TeamUser{
				User: user,
				Team: user.Team,
			})
			return next(c)
		}
	}
}

// TeamAuthCheck 团队认证中间件（不强制）
func (a *AuthMiddleware) TeamAuthCheck() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ctx := c.Request().Context()

			user, err := session.Get[*domain.User](a.Session, c, consts.MonkeyCodeAITeamSession)
			if err != nil {
				a.logger.DebugContext(ctx, "get team session failed", "error", err)
				return c.String(http.StatusUnauthorized, "Unauthorized")
			}

			if user == nil {
				return c.String(http.StatusUnauthorized, "Unauthorized")
			}

			if user.Team == nil {
				return c.String(http.StatusUnauthorized, "User has no team")
			}

			SetTeamUser(c, &domain.TeamUser{
				User: user,
				Team: user.Team,
			})
			return next(c)
		}
	}
}
