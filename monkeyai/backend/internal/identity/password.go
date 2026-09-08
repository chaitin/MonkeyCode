package identity

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strconv"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
)

const (
	passwordIterations = 600_000
	dummyPasswordHash  = "$pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
)

func (s *Service) EnsureInitialAdmin(ctx context.Context, name, email, password string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := sqlc.New(tx).LockInitialAdmin(ctx); err != nil {
		return err
	}
	var count int
	record, err := sqlc.New(tx).CountUsers(ctx)
	if err != nil {
		return err
	}
	count = int(record)

	if count > 0 {
		return tx.Commit(ctx)
	}
	email = strings.ToLower(strings.TrimSpace(email))
	name = strings.TrimSpace(name)
	if name == "" || !validEmail(email) || len(password) < 12 {
		return errors.New("用户表为空，必须配置有效的首次管理员姓名、邮箱和密码")
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	_, err = sqlc.New(tx).CreateInitialAdmin(ctx, sqlc.CreateInitialAdminParams{Name: name, Email: email, PasswordHash: new(hash)})
	if err != nil {
		return fmt.Errorf("创建首次管理员: %w", err)
	}
	return tx.Commit(ctx)
}

func (s *Service) passwordLogin(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&input); err != nil || len(input.Password) > 1024 {
		writeError(w, http.StatusBadRequest, "invalid_request", "请求格式无效")
		return
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	var user User
	var passwordHash string
	row, err := sqlc.New(s.db).GetPasswordUser(r.Context(), input.Email)
	if err == nil && row.PasswordHash == nil {
		err = errors.New("未设置密码")
	}
	if err == nil {
		user = User{ID: row.ID, Name: row.Name, Email: row.Email, AvatarURL: row.AvatarUrl, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt, LastLoginAt: row.LastLoginAt}
		passwordHash = *row.PasswordHash
	}
	if err != nil {
		passwordHash = dummyPasswordHash
	}
	valid := verifyPassword(input.Password, passwordHash)
	if err != nil || !valid {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "邮箱或密码错误")
		return
	}
	if _, err := sqlc.New(s.db).TouchLogin(r.Context(), user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "登录失败")
		return
	}
	token, err := randomToken(32)
	if err != nil || s.createBrowserSession(r.Context(), user.ID, tokenHash(token), "password", s.now().Add(s.sessionTTL)) != nil {
		writeError(w, http.StatusInternalServerError, "server_error", "登录失败")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", HttpOnly: true,
		Secure: s.secureCookie, SameSite: http.SameSiteLaxMode,
		MaxAge: int(s.sessionTTL.Seconds()),
	})
	writeJSON(w, http.StatusOK, user)
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key, err := pbkdf2.Key(sha256.New, password, salt, passwordIterations, 32)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("$pbkdf2-sha256$%d$%s$%s", passwordIterations, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

func verifyPassword(password, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 5 || parts[1] != "pbkdf2-sha256" {
		return false
	}
	iterations, err := strconv.Atoi(parts[2])
	if err != nil || iterations < 100_000 || iterations > 2_000_000 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil || len(salt) < 16 {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(expected) != 32 {
		return false
	}
	actual, err := pbkdf2.Key(sha256.New, password, salt, iterations, len(expected))
	return err == nil && subtle.ConstantTimeCompare(actual, expected) == 1
}

func validEmail(value string) bool {
	address, err := mail.ParseAddress(value)
	return err == nil && strings.EqualFold(address.Address, value)
}
