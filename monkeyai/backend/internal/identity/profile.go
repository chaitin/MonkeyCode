package identity

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/jackc/pgx/v5"
)

const profileCSRF = "account-profile"

func (s *Service) profile(w http.ResponseWriter, r *http.Request) {
	user, _ := UserFromContext(r.Context())
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	row, err := sqlc.New(s.db).GetProfile(ctx, user.ID)
	if err != nil {
		profileFailure(ctx, w, err)
		return
	}
	user.AvatarURL = strings.TrimSpace(row.CustomAvatarUrl)
	if user.AvatarURL == "" {
		user.AvatarURL = strings.TrimSpace(row.SyncedAvatarUrl)
	}
	writeJSON(ctx, w, http.StatusOK, map[string]any{
		"user": user, "custom_avatar_url": row.CustomAvatarUrl,
		"synced_avatar_url": row.SyncedAvatarUrl, "has_password": row.HasPassword,
		"csrf_token": consentToken(r, profileCSRF),
	})
}

func (s *Service) profileMutation(w http.ResponseWriter, r *http.Request) bool {
	if err := verifyConsent(r, profileCSRF, s.publicURL); err != nil {
		writeError(r.Context(), w, http.StatusForbidden, "invalid_csrf", "操作已失效，请刷新页面后重试")
		return false
	}
	return true
}

func profileContext(r *http.Request) (context.Context, context.CancelFunc) {
	user, _ := UserFromContext(r.Context())
	return context.WithTimeout(audit.WithRequest(r, audit.Actor{ID: user.ID, Name: user.Name, Email: user.Email}), 20*time.Second)
}

func rollbackProfile(ctx context.Context, tx pgx.Tx) {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := tx.Rollback(cleanup); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
		logging.Event(cleanup, slog.Default(), slog.LevelError, "identity.profile.failed", "回滚个人设置失败", "error", err)
	}
}

func profileFailure(ctx context.Context, w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(ctx, w, http.StatusUnauthorized, "unauthorized", "登录已失效，请重新登录")
		return
	}
	logging.Event(ctx, slog.Default(), slog.LevelError, "identity.profile.failed", "更新或读取个人设置失败", "error", err)
	writeError(ctx, w, http.StatusInternalServerError, "server_error", "个人设置操作失败，请重试")
}

func (s *Service) changePassword(w http.ResponseWriter, r *http.Request) {
	if !s.profileMutation(w, r) {
		return
	}
	var in struct {
		Current string `json:"current_password"`
		Next    string `json:"new_password"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil || decoder.Decode(new(any)) != io.EOF ||
		in.Current == "" || len(in.Current) > 1024 || len(in.Next) > 1024 || utf8.RuneCountInString(in.Next) < 12 {
		writeError(r.Context(), w, 400, "invalid_request", "请输入当前密码，新密码需为 12 个字符以上且不超过 1024 字节")
		return
	}
	user, _ := UserFromContext(r.Context())
	ctx, cancel := profileContext(r)
	defer cancel()
	q := sqlc.New(s.db)
	allowed, err := q.ProfilePasswordAttempt(ctx, user.ID)
	if err != nil {
		profileFailure(ctx, w, err)
		return
	}
	if !allowed {
		w.Header().Set("Retry-After", "900")
		writeError(ctx, w, 429, "rate_limited", "密码校验过于频繁，请 15 分钟后重试")
		return
	}
	credentials, err := q.GetProfileCredentials(ctx, user.ID)
	if err != nil {
		profileFailure(ctx, w, err)
		return
	}
	if credentials.PasswordHash == nil || *credentials.PasswordHash == "" {
		writeError(ctx, w, 400, "password_not_set", "账号尚未设置密码，请通过登录页的找回密码设置")
		return
	}
	if !verifyPassword(in.Current, *credentials.PasswordHash) {
		writeError(ctx, w, 403, "invalid_password", "当前密码不正确")
		return
	}
	if in.Current == in.Next {
		writeError(ctx, w, 400, "unchanged_password", "新密码不能与当前密码相同")
		return
	}
	hash, err := hashPassword(in.Next)
	if err != nil {
		profileFailure(ctx, w, err)
		return
	}
	newToken, err := randomToken(32)
	if err != nil {
		profileFailure(ctx, w, err)
		return
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		profileFailure(ctx, w, err)
		return
	}
	defer rollbackProfile(ctx, tx)
	q = sqlc.New(tx)
	// Device decisions and token polls lock the request before its owner.
	// Follow the same order, then detect approvals committed while acquiring
	// the user lock. Retrying leaves the password and all revocations atomic.
	if err = q.RevokeProfileDeviceApprovals(ctx, new(user.ID)); err != nil {
		profileFailure(ctx, w, err)
		return
	}
	locked, err := q.LockProfileCredentials(ctx, user.ID)
	if err != nil {
		profileFailure(ctx, w, err)
		return
	}
	if locked.PasswordHash == nil || *locked.PasswordHash != *credentials.PasswordHash {
		writeError(ctx, w, 409, "password_changed", "密码已发生变化，请重新输入当前密码")
		return
	}
	approved, err := q.HasProfileDeviceApprovals(ctx, new(user.ID))
	if err != nil {
		profileFailure(ctx, w, err)
		return
	}
	if approved {
		writeError(ctx, w, 409, "authorization_changed", "设备授权正在变化，请重新提交密码修改")
		return
	}
	cookie, _ := r.Cookie(sessionCookie)
	if _, err = q.LockProfileBrowserSession(ctx, sqlc.LockProfileBrowserSessionParams{UserID: user.ID, TokenHash: tokenHash(cookie.Value)}); err != nil {
		profileFailure(ctx, w, err)
		return
	}
	_, err = q.SetProfilePassword(ctx, sqlc.SetProfilePasswordParams{ID: user.ID, PasswordHash: new(hash)})
	if err == nil {
		err = q.RevokeUserSessions(ctx, user.ID)
	}
	var grants []string
	if err == nil {
		grants, err = q.RevokeProfileTokens(ctx, user.ID)
	}
	if err == nil {
		err = q.RevokeUserCodes(ctx, user.ID)
	}
	if err == nil {
		err = q.DeleteEmailCode(ctx, sqlc.DeleteEmailCodeParams{Email: locked.Email, Purpose: "login"})
	}
	if err == nil {
		err = q.DeleteEmailCode(ctx, sqlc.DeleteEmailCodeParams{Email: locked.Email, Purpose: "reset"})
	}
	if err == nil {
		err = q.ClearProfilePasswordAttempts(ctx, user.ID)
	}
	if err == nil {
		_, err = q.CreateBrowserSession(ctx, sqlc.CreateBrowserSessionParams{
			TokenHash: tokenHash(newToken), UserID: user.ID, AuthenticationMethod: "password", ExpiresAt: s.now().Add(s.sessionTTL),
		})
	}
	if err == nil {
		err = audit.Write(ctx, tx, audit.Event{ActorID: user.ID, Action: "change_password", Category: "security", TargetType: "user", TargetID: user.ID})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		profileFailure(ctx, w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: newToken, Path: "/", HttpOnly: true, Secure: s.secureCookie, SameSite: http.SameSiteLaxMode, MaxAge: int(s.sessionTTL.Seconds())})
	if len(grants) > 0 && s.grantRevoker != nil {
		// Revocation is already durable. Disconnect live clients without making
		// the response wait for per-grant host storage cleanup.
		go func() {
			for _, id := range grants {
				s.NotifyGrantRevoked(id)
			}
		}()
	}
	// The old session and its CSRF token are invalid after rotation.
	r = r.Clone(ctx)
	r.Header.Set("Cookie", (&http.Cookie{Name: sessionCookie, Value: newToken}).String())
	writeJSON(ctx, w, 200, map[string]string{"csrf_token": consentToken(r, profileCSRF)})
}
