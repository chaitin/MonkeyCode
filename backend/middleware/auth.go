package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/crypto"
)

const (
	// UserContextKey 用户上下文键
	UserContextKey = "user"
	UserSessionKey = "monkeycode_ai_user:%s"
	// TeamUserContextKey 团队用户上下文键
	TeamUserContextKey = "team_user"
	TeamUserSessionKey = "monkeycode_ai_team_user:%s"
)

type Field struct {
	UID          string    `json:"uid"`
	RandomString uuid.UUID `json:"random_string"`
}

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
	cfg     *config.Config
	usecase domain.UserUsecase
	logger  *slog.Logger
	redis   *redis.Client
}

// NewAuthMiddleware 创建认证中间件管理器
func NewAuthMiddleware(
	cfg *config.Config,
	usecase domain.UserUsecase,
	logger *slog.Logger,
	redisClient *redis.Client,
) *AuthMiddleware {
	return &AuthMiddleware{
		cfg:     cfg,
		usecase: usecase,
		logger:  logger.With("module", "AuthMiddleware"),
		redis:   redisClient,
	}
}

// Auth 强制要求认证
func (a *AuthMiddleware) Auth() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ctx := c.Request().Context()

			cookie, err := c.Cookie(consts.MonkeyCodeAISession)
			if err != nil {
				a.logger.DebugContext(ctx, "no cookie found, skipping auth")
				return c.String(http.StatusUnauthorized, "No Cookie Found")
			}

			user, err := a.GetUserFromRedis(ctx, UserSessionKey, cookie.Value)
			if err != nil {
				a.logger.DebugContext(ctx, "get user from redis failed", "error", err)
				return c.String(http.StatusUnauthorized, "Invalid Cookie")
			}

			if user == nil {
				a.logger.DebugContext(ctx, "no user found, skipping auth")
				return c.String(http.StatusUnauthorized, "Invalid Cookie")
			}

			user.Token = cookie.Value
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

			cookie, err := c.Cookie(consts.MonkeyCodeAISession)
			if err != nil {
				a.logger.DebugContext(ctx, "no cookie found, skipping auth")
				return next(c)
			}

			user, err := a.GetUserFromRedis(ctx, UserSessionKey, cookie.Value)
			if err != nil {
				a.logger.DebugContext(ctx, "get user from redis failed", "error", err)
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

			cookie, err := c.Cookie(consts.MonkeyCodeAITeamSession)
			if err != nil {
				a.logger.DebugContext(ctx, "no cookie found, skipping auth")
				return c.String(http.StatusUnauthorized, "No Cookie Found")
			}

			user, err := a.GetUserFromRedis(ctx, TeamUserSessionKey, cookie.Value)
			if err != nil {
				a.logger.DebugContext(ctx, "get user from redis failed", "error", err)
				return c.String(http.StatusUnauthorized, "No Cookie Found")
			}

			if user == nil {
				return c.String(http.StatusUnauthorized, "No Cookie Found")
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

// TeamAuthCheck 团队认证中间件
func (a *AuthMiddleware) TeamAuthCheck() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ctx := c.Request().Context()

			cookie, err := c.Cookie(consts.MonkeyCodeAITeamSession)
			if err != nil {
				a.logger.DebugContext(ctx, "no cookie found, skipping auth")
				return c.String(http.StatusUnauthorized, "cookie not found")
			}

			user, err := a.GetUserFromRedis(ctx, TeamUserSessionKey, cookie.Value)
			if err != nil {
				a.logger.DebugContext(ctx, "get user from redis failed", "error", err)
				return c.String(http.StatusUnauthorized, "session not found")
			}

			a.logger.InfoContext(ctx, "get team user from redis", "user", user)

			if user == nil {
				return c.String(http.StatusUnauthorized, "session not found")
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

// SetUserCookieIntoRedis 设置用户的 Redis Cookie
func (a *AuthMiddleware) SetUserCookieIntoRedis(ctx context.Context, cookie, prefix string, user *domain.User) error {
	b, err := json.Marshal(user)
	if err != nil {
		return err
	}

	key := fmt.Sprintf(prefix, user.ID.String())
	err = a.redis.HSet(ctx, key, cookie, b).Err()
	if err != nil {
		return err
	}
	err = a.redis.Expire(ctx, key, time.Duration(a.cfg.Session.Expire)*time.Second).Err()
	if err != nil {
		return err
	}
	return nil
}

// GetUserFromRedis 从 Redis 中获取用户信息
func (a *AuthMiddleware) GetUserFromRedis(ctx context.Context, prefix, cookie string) (*domain.User, error) {
	cryptor, err := crypto.NewAESEncryptorFromString(a.cfg.Session.Secret)
	if err != nil {
		a.logger.DebugContext(ctx, "new aes encryptor failed", "error", err)
	}
	field, err := cryptor.DecryptString(cookie)
	if err != nil {
		a.logger.DebugContext(ctx, "decrypt token failed", "error", err)
	}
	fieldData := &Field{}
	if err := json.Unmarshal([]byte(field), fieldData); err != nil {
		a.logger.DebugContext(ctx, "unmarshal field failed", "error", err)
		return nil, err
	}
	key := fmt.Sprintf(prefix, fieldData.UID)
	userBytes, err := a.redis.HGet(ctx, key, cookie).Result()
	if err != nil {
		a.logger.DebugContext(ctx, "get user from redis failed", "error", err)
		return nil, err
	}
	var user domain.User
	if err := json.Unmarshal([]byte(userBytes), &user); err != nil {
		a.logger.DebugContext(ctx, "unmarshal user failed", "error", err)
		return nil, err
	}
	return &user, nil
}

// GenerateCookieByUID 根据 id 生成 Cookie
func (a *AuthMiddleware) GenerateCookieByUID(ctx context.Context, uid uuid.UUID) (string, error) {
	fieldData := &Field{
		UID:          uid.String(),
		RandomString: uuid.New(),
	}
	field, err := json.Marshal(fieldData)
	if err != nil {
		return "", err
	}
	cryptor, err := crypto.NewAESEncryptorFromString(a.cfg.Session.Secret)
	if err != nil {
		return "", err
	}
	encryptedField, err := cryptor.EncryptString(string(field))
	if err != nil {
		return "", err
	}
	return encryptedField, nil
}

// DeleteUserCookieFromRedis 删除用户 Cookie 从 Redis
func (a *AuthMiddleware) DeleteUserCookieFromRedis(ctx context.Context, prefix string, uid uuid.UUID) error {
	key := fmt.Sprintf(prefix, uid.String())
	err := a.redis.Del(ctx, key).Err()
	if err != nil {
		a.logger.DebugContext(ctx, "delete user cookie from redis failed", "error", err)
		return err
	}
	a.logger.DebugContext(ctx, "delete user cookie from redis success", "key", key)
	return nil
}

// FlushRedisUserInfo 刷新用户信息到 Cookie
func (a *AuthMiddleware) FlushRedisUserInfo(ctx context.Context, uid uuid.UUID, user *domain.User) error {
	userBytes, err := json.Marshal(user)
	if err != nil {
		return err
	}
	key := fmt.Sprintf(UserSessionKey, uid.String())

	cookieMap, err := a.redis.HGetAll(ctx, key).Result()
	if err != nil {
		a.logger.DebugContext(ctx, "get cookie map from redis failed", "error", err)
		return err
	}

	// 遍历 hashmap 并更新每个 cookie 对应的用户信息
	for cookie := range cookieMap {
		err = a.redis.HSet(ctx, key, cookie, userBytes).Err()
		if err != nil {
			a.logger.DebugContext(ctx, "update user info in redis failed", "error", err, "cookie", cookie)
			return err
		}
	}
	return nil
}
