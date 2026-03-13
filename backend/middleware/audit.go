package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

// responseWriter 包装 http.ResponseWriter 以捕获响应内容
type responseWriter struct {
	http.ResponseWriter
	body *bytes.Buffer
}

func (w *responseWriter) Write(data []byte) (int, error) {
	w.body.Write(data)
	return w.ResponseWriter.Write(data)
}

// AuditMiddleware 审计中间件
type AuditMiddleware struct {
	logger      *slog.Logger
	usecase     domain.AuditUsecase
	userUsecase domain.UserUsecase
}

// NewAuditMiddleware 创建审计中间件
func NewAuditMiddleware(
	logger *slog.Logger,
	usecase domain.AuditUsecase,
	userUsecase domain.UserUsecase,
) *AuditMiddleware {
	return &AuditMiddleware{
		logger:      logger.With("module", "AuditMiddleware"),
		usecase:     usecase,
		userUsecase: userUsecase,
	}
}

// Audit 审计中间件
func (a *AuditMiddleware) Audit(operation string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ctx := c.Request().Context()
			teamUser := GetTeamUser(c)

			// 请求体
			bodyBytes, err := io.ReadAll(c.Request().Body)
			if err != nil {
				a.logger.ErrorContext(ctx, "failed to read request body", "error", err)
				return next(c)
			}
			c.Request().Body = io.NopCloser(bytes.NewReader(bodyBytes))
			requestBody := string(bodyBytes)

			// 响应体
			respWriter := &responseWriter{ResponseWriter: c.Response().Writer, body: &bytes.Buffer{}}
			c.Response().Writer = respWriter

			err = next(c)
			if err != nil {
				return err
			}

			// 响应内容
			responseBody := respWriter.body.String()

			if operation == "team_user_login" {
				req := &domain.TeamLoginReq{}
				err = json.Unmarshal(bodyBytes, req)
				if err != nil {
					a.logger.ErrorContext(ctx, "failed to unmarshal login response body", "error", err)
					return nil
				}
				users, err := a.userUsecase.GetUserByEmail(ctx, []string{req.Email})
				if err != nil {
					a.logger.ErrorContext(ctx, "failed to get user by email", "error", err)
					return nil
				}
				teamUser = &domain.TeamUser{
					User: &domain.User{},
				}
				if len(users) > 0 {
					teamUser = &domain.TeamUser{
						User: users[0],
						Team: users[0].Team,
					}
				}
			}

			// 构建审计记录，需要检查 teamUser 和 teamUser.User 是否为 nil
			audit := &domain.Audit{
				SourceIP:  c.RealIP(),
				UserAgent: c.Request().UserAgent(),
				Request:   requestBody,
				Response:  responseBody,
				Operation: operation,
				User:      teamUser.User,
			}
			reqBody, respBody, err := maskSensitiveData(operation, requestBody, responseBody)
			if err != nil {
				a.logger.ErrorContext(ctx, "failed to mask sensitive data", "error", err)
				return nil
			}
			audit.Request = reqBody
			audit.Response = respBody
			err = a.usecase.CreateAudit(ctx, audit)
			if err != nil {
				a.logger.ErrorContext(ctx, "failed to create audit", "error", err)
			}
			return nil
		}
	}
}

// maskJSON 通用的 JSON 脱敏处理函数
// maskFunc 是一个函数，接收解析后的对象并对其进行脱敏处理
func maskJSON[T any](body string, maskFunc func(*T)) (string, error) {
	if body == "" {
		return body, nil
	}
	var obj T
	if err := json.Unmarshal([]byte(body), &obj); err != nil {
		return body, nil // 如果解析失败，返回原始内容（不报错，避免影响审计流程）
	}
	maskFunc(&obj)
	bytes, err := json.Marshal(obj)
	if err != nil {
		return body, err
	}
	return string(bytes), nil
}

// maskSensitiveData 数据脱敏处理
func maskSensitiveData(operation, reqBody, respBody string) (string, string, error) {
	var err error

	switch operation {
	case "team_user_login":
		reqBody, err = maskJSON(reqBody, func(req *domain.TeamLoginReq) {
			req.Password = "********"
		})
		if err != nil {
			return "", "", err
		}
	case "change_team_user_password":
		reqBody, err = maskJSON(reqBody, func(req *domain.ChangePasswordReq) {
			req.CurrentPassword = "********"
			req.NewPassword = "********"
		})
		if err != nil {
			return "", "", err
		}
	}

	return reqBody, respBody, nil
}
