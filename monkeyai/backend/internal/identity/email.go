package identity

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/jackc/pgx/v5"
)

type EmailSender interface {
	Send(context.Context, string, string, string) error
}

func (s *Service) WithEmailSender(sender EmailSender) *Service { s.email = sender; return s }

type loginMethods struct {
	PasswordEnabled     bool `json:"password_enabled"`
	EmailCodeEnabled    bool `json:"email_code_enabled"`
	RegistrationEnabled bool `json:"registration_enabled"`
}

func (s *Service) loginMethods(ctx context.Context) (loginMethods, error) {
	methods := loginMethods{PasswordEnabled: true}
	value, err := s.settings.GetValue(ctx, "authentication")
	if err != nil {
		return loginMethods{}, err
	}
	err = json.Unmarshal(value, &methods)
	return methods, err
}

func (s *Service) methods(w http.ResponseWriter, r *http.Request) {
	methods, err := s.loginMethods(r.Context())
	if err != nil {
		writeError(w, 503, "settings_unavailable", "认证配置不可用")
		return
	}
	writeJSON(w, 200, methods)
}

func (s *Service) allowEmail(w http.ResponseWriter, r *http.Request, purpose string) bool {
	methods, err := s.loginMethods(r.Context())
	if err != nil {
		writeError(w, 503, "settings_unavailable", "认证配置不可用")
		return false
	}
	allowed := false
	switch purpose {
	case "login":
		allowed = methods.EmailCodeEnabled
	case "register":
		allowed = methods.RegistrationEnabled && (methods.PasswordEnabled || methods.EmailCodeEnabled)
	case "reset":
		allowed = methods.PasswordEnabled
	}
	if !allowed {
		writeError(w, 403, "method_disabled", "该认证方式未启用")
		return false
	}
	return true
}

type emailInput struct {
	Email    string `json:"email"`
	Code     string `json:"code"`
	Purpose  string `json:"purpose"`
	Name     string `json:"name"`
	Password string `json:"password"`
}

func readEmailInput(w http.ResponseWriter, r *http.Request) (emailInput, bool) {
	var input emailInput
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&input)
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	input.Name = strings.TrimSpace(input.Name)
	if err != nil || !validEmail(input.Email) || len(input.Email) > 254 || len(input.Password) > 1024 || len(input.Name) > 200 {
		writeError(w, 400, "invalid_request", "请求格式或邮箱无效")
		return input, false
	}
	return input, true
}

func (s *Service) sendCode(w http.ResponseWriter, r *http.Request) {
	input, ok := readEmailInput(w, r)
	if !ok {
		return
	}
	if input.Purpose != "login" && input.Purpose != "register" && input.Purpose != "reset" {
		writeError(w, 400, "invalid_request", "验证码用途无效")
		return
	}
	if !s.allowEmail(w, r, input.Purpose) {
		return
	}
	if s.email == nil {
		writeError(w, 503, "email_unavailable", "邮件服务未配置")
		return
	}
	number, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		writeError(w, 500, "server_error", "生成验证码失败")
		return
	}
	code := fmt.Sprintf("%06d", number.Int64())
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	err = s.reserveCode(r.Context(), input, code, tokenHash(ip))
	if errors.Is(err, errCodeLimited) {
		w.Header().Set("Retry-After", "60")
		writeError(w, 429, "rate_limited", "发送过于频繁，请稍后重试")
		return
	}
	if err != nil {
		writeError(w, 500, "server_error", "发送验证码失败")
		return
	}
	// 对不存在、已停用或不符合用途的账号返回相同结果，避免泄露账号状态。
	user, lookupErr := sqlc.New(s.db).GetUserByEmail(r.Context(), input.Email)
	eligible := lookupErr == nil && user.Status == "active"
	if input.Purpose == "register" {
		eligible = errors.Is(lookupErr, pgx.ErrNoRows)
	}
	if lookupErr != nil && !errors.Is(lookupErr, pgx.ErrNoRows) {
		writeError(w, 500, "server_error", "发送验证码失败")
		return
	}
	if eligible {
		labels := map[string]string{"login": "登录", "register": "注册", "reset": "重置密码"}
		err = s.email.Send(r.Context(), input.Email, "MonkeyAI "+labels[input.Purpose]+"验证码", fmt.Sprintf("你的%s验证码为：%s\n\n验证码 10 分钟内有效，仅可使用一次。如非本人操作，请忽略此邮件。", labels[input.Purpose], code))
		if err != nil {
			writeError(w, 502, "email_failed", "邮件发送失败，请稍后重试或联系管理员")
			return
		}
		if err := sqlc.New(s.db).ReadyEmailCode(r.Context(), sqlc.ReadyEmailCodeParams{Email: input.Email, Purpose: input.Purpose, CodeHash: emailCodeHash(input, code)}); err != nil {
			writeError(w, 500, "server_error", "发送验证码失败")
			return
		}
	}
	writeJSON(w, 200, map[string]any{"message": "如果该邮箱符合条件，验证码将发送至邮箱", "retry_after": 60})
}

var errCodeLimited = errors.New("验证码发送过于频繁")
var errInvalidCode = errors.New("验证码无效、已过期或错误次数过多")

func emailCodeHash(input emailInput, code string) string {
	return tokenHash(input.Email + "\x00" + input.Purpose + "\x00" + code)
}

func (s *Service) reserveCode(ctx context.Context, input emailInput, code, ipHash string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := sqlc.New(tx)
	if err := q.LockEmailDelivery(ctx); err != nil {
		return err
	}
	if err := q.CleanEmailDeliveries(ctx); err != nil {
		return err
	}
	if err := q.CleanEmailCodes(ctx); err != nil {
		return err
	}
	limited, err := q.EmailDeliveryLimited(ctx, sqlc.EmailDeliveryLimitedParams{Email: input.Email, IpHash: ipHash})
	if err != nil {
		return err
	}
	if limited {
		return errCodeLimited
	}
	if err := q.RecordEmailDelivery(ctx, sqlc.RecordEmailDeliveryParams{Email: input.Email, IpHash: ipHash}); err != nil {
		return err
	}
	if err := q.SaveEmailCode(ctx, sqlc.SaveEmailCodeParams{Email: input.Email, Purpose: input.Purpose, CodeHash: emailCodeHash(input, code), ExpiresAt: s.now().Add(10 * time.Minute)}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func consumeEmailCode(ctx context.Context, tx pgx.Tx, input emailInput) error {
	q := sqlc.New(tx)
	row, err := q.GetEmailCode(ctx, sqlc.GetEmailCodeParams{Email: input.Email, Purpose: input.Purpose})
	if errors.Is(err, pgx.ErrNoRows) {
		return errInvalidCode
	}
	if err != nil {
		return err
	}
	if row.Attempts >= 5 {
		return errInvalidCode
	}
	if subtle.ConstantTimeCompare([]byte(row.CodeHash), []byte(emailCodeHash(input, input.Code))) != 1 {
		if err := q.FailEmailCode(ctx, sqlc.FailEmailCodeParams{Email: input.Email, Purpose: input.Purpose}); err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		return errInvalidCode
	}
	return q.DeleteEmailCode(ctx, sqlc.DeleteEmailCodeParams{Email: input.Email, Purpose: input.Purpose})
}

func (s *Service) emailLogin(w http.ResponseWriter, r *http.Request) { s.completeEmail(w, r, "login") }
func (s *Service) registerEmail(w http.ResponseWriter, r *http.Request) {
	s.completeEmail(w, r, "register")
}
func (s *Service) resetPassword(w http.ResponseWriter, r *http.Request) {
	s.completeEmail(w, r, "reset")
}

func (s *Service) completeEmail(w http.ResponseWriter, r *http.Request, purpose string) {
	input, ok := readEmailInput(w, r)
	if !ok {
		return
	}
	input.Purpose = purpose
	if !s.allowEmail(w, r, purpose) {
		return
	}
	if len(input.Code) != 6 || strings.Trim(input.Code, "0123456789") != "" {
		writeError(w, 400, "invalid_request", "请输入六位数字验证码")
		return
	}
	if purpose == "reset" && len(input.Password) < 12 || purpose == "register" && (input.Name == "" || len(input.Password) < 12) {
		writeError(w, 400, "invalid_request", "姓名不能为空，密码至少 12 个字符")
		return
	}
	ctx := r.Context()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		writeError(w, 500, "server_error", "认证失败")
		return
	}
	defer tx.Rollback(ctx)
	if err := consumeEmailCode(ctx, tx, input); err != nil {
		if errors.Is(err, errInvalidCode) {
			writeError(w, 400, "invalid_code", errInvalidCode.Error())
		} else {
			writeError(w, 500, "server_error", "认证失败")
		}
		return
	}
	q := sqlc.New(tx)
	var user User
	switch purpose {
	case "register":
		hash, hashErr := hashPassword(input.Password)
		if hashErr != nil {
			writeError(w, 500, "server_error", "注册失败")
			return
		}
		row, createErr := q.CreateUser(ctx, sqlc.CreateUserParams{Name: input.Name, Email: input.Email, Role: "user", PasswordHash: &hash})
		if createErr != nil {
			writeError(w, 409, "registration_failed", "注册失败，该邮箱可能已被使用")
			return
		}
		user = User{ID: row.ID, Name: row.Name, Email: row.Email, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt}
	case "reset":
		hash, hashErr := hashPassword(input.Password)
		if hashErr != nil {
			writeError(w, 500, "server_error", "密码重置失败")
			return
		}
		id, resetErr := q.ResetPassword(ctx, sqlc.ResetPasswordParams{Email: input.Email, PasswordHash: &hash})
		if resetErr == nil {
			resetErr = q.RevokeUserSessions(ctx, id)
		}
		if resetErr == nil {
			resetErr = q.RevokeUserTokens(ctx, id)
		}
		if resetErr == nil {
			resetErr = q.RevokeUserCodes(ctx, id)
		}
		if resetErr == nil {
			resetErr = q.DeleteEmailCode(ctx, sqlc.DeleteEmailCodeParams{Email: input.Email, Purpose: "login"})
		}
		if resetErr != nil {
			writeError(w, 400, "reset_failed", "密码重置失败，请重新获取验证码")
			return
		}
	default:
		row, lookupErr := q.GetUserByEmail(ctx, input.Email)
		admin := strings.HasPrefix(r.URL.Path, "/admin/") || strings.Contains(r.URL.Path, "/v1/admin/")
		if lookupErr != nil || row.Status != "active" || admin && row.Role != "admin" || !admin && row.Role != "user" {
			writeError(w, 401, "invalid_credentials", "账号不可用于此登录入口")
			return
		}
		user = User{ID: row.ID, Name: row.Name, Email: row.Email, AvatarURL: row.AvatarUrl, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt}
	}
	if err := tx.Commit(ctx); err != nil {
		writeError(w, 500, "server_error", "认证失败")
		return
	}
	if purpose == "reset" {
		writeJSON(w, 200, map[string]bool{"reset": true})
		return
	}
	s.loginSession(w, r, user, "email_code")
}
