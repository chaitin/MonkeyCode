package identity

import (
	"encoding/json"
	"errors"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"log/slog"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/member"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func (s *Service) RegisterAdmin(router chi.Router) {
	router.Get("/me", func(w http.ResponseWriter, r *http.Request) {
		user, _ := UserFromContext(r.Context())
		writeJSON(r.Context(), w, http.StatusOK, user)
	})
	router.Get("/users", func(w http.ResponseWriter, r *http.Request) {
		users, err := s.listUsers(r.Context())
		if err != nil {
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "读取用户列表失败", "module", "identity", "operation", "RegisterAdmin", "error", err)
			writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "读取用户失败")
			return
		}
		writeJSON(r.Context(), w, http.StatusOK, map[string]any{"users": users})
	})
	router.Post("/users", s.createUser)
	router.Get("/users/{userID}", s.getUser)
	router.Patch("/users/{userID}", s.patchUser)
	router.Post("/users/{userID}/reset-password", s.resetUserPassword)
}

func (s *Service) RegisterAgent(router chi.Router) {
	router.Get("/users", s.searchUsers)
	router.Get("/me", func(w http.ResponseWriter, r *http.Request) {
		user, _ := UserFromContext(r.Context())
		writeJSON(r.Context(), w, http.StatusOK, user)
	})
}

func (s *Service) getUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userID")
	user, err := s.userByID(r.Context(), userID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(r.Context(), w, http.StatusNotFound, "user_not_found", "用户不存在")
		return
	}
	if err != nil {
		logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "读取用户失败", "module", "identity", "operation", "getUser", "user_id", userID, "error", err)
		writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "读取用户失败")
		return
	}
	writeJSON(r.Context(), w, http.StatusOK, user)
}

func (s *Service) patchUser(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name   string `json:"name"`
		Role   string `json:"role"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid_request", "请求格式无效")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || (input.Role != "admin" && input.Role != "user") || (input.Status != "active" && input.Status != "disabled") {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid_request", "name、role 或 status 无效")
		return
	}
	current, _ := UserFromContext(r.Context())
	if current.ID == chi.URLParam(r, "userID") && (input.Role != "admin" || input.Status != "active") {
		writeError(r.Context(), w, http.StatusConflict, "cannot_disable_self", "不能停用自己或移除自己的管理员角色")
		return
	}
	user, err := s.updateUser(r.Context(), chi.URLParam(r, "userID"), input.Name, input.Role, input.Status, "")
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound), errors.Is(err, pgx.ErrNoRows):
			writeError(r.Context(), w, http.StatusNotFound, "user_not_found", "用户不存在")
		case errors.Is(err, member.ErrSeatsExceeded):
			writeError(r.Context(), w, http.StatusConflict, "seats_exceeded", member.ErrSeatsExceeded.Error())
		case errors.Is(err, member.ErrSeatsUnavailable):
			writeError(r.Context(), w, http.StatusServiceUnavailable, "seats_unavailable", member.ErrSeatsUnavailable.Error())
		case errors.Is(err, member.ErrWriterUnavailable):
			writeError(r.Context(), w, http.StatusServiceUnavailable, "member_writer_unavailable", "成员写入能力不可用")
		default:
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "更新用户失败", "module", "identity", "operation", "patchUser", "user_id", chi.URLParam(r, "userID"), "error", err)
			writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "更新用户失败")
		}
		return
	}
	writeJSON(r.Context(), w, http.StatusOK, user)
}

func (s *Service) resetUserPassword(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	password, err := generatePassword()
	if err != nil {
		logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "生成重置密码失败", "module", "identity", "operation", "resetUserPassword", "user_id", chi.URLParam(r, "userID"), "error", err)
		writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "生成密码失败")
		return
	}
	hash, err := hashPassword(password)
	if err != nil {
		logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "重置用户密码失败", "module", "identity", "operation", "resetUserPassword", "user_id", chi.URLParam(r, "userID"), "error", err)
		writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "重置密码失败")
		return
	}
	ctx := r.Context()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "重置用户密码失败", "module", "identity", "operation", "resetUserPassword", "user_id", chi.URLParam(r, "userID"), "error", err)
		writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "重置密码失败")
		return
	}
	defer func() {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) && ctx.Err() == nil {
			logging.Event(ctx, slog.Default(), slog.LevelError, "identity.request.failed", "回滚重置用户密码事务失败", "module", "identity", "operation", "resetUserPassword", "user_id", chi.URLParam(r, "userID"), "error", err)
		}
	}()
	q := sqlc.New(tx)
	user, err := q.GetUser(ctx, chi.URLParam(r, "userID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(r.Context(), w, http.StatusNotFound, "user_not_found", "用户不存在")
		return
	}
	if err != nil {
		logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "重置用户密码失败", "module", "identity", "operation", "resetUserPassword", "user_id", chi.URLParam(r, "userID"), "error", err)
		writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "重置密码失败")
		return
	}
	err = s.writer.ResetUserPassword(ctx, tx, user.ID, hash)
	if err != nil {
		if errors.Is(err, member.ErrWriterUnavailable) {
			writeError(r.Context(), w, http.StatusServiceUnavailable, "member_writer_unavailable", "成员写入能力不可用")
		} else {
			logging.Event(ctx, slog.Default(), slog.LevelError, "identity.request.failed", "更新用户密码失败", "module", "identity", "operation", "resetUserPassword", "user_id", user.ID, "error", err)
			writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "重置密码失败")
		}
		return
	}
	if err := revokePasswordAccess(ctx, q, user.ID, user.Email); err != nil {
		logging.Event(ctx, slog.Default(), slog.LevelError, "identity.request.failed", "撤销用户旧凭据失败", "module", "identity", "operation", "resetUserPassword", "user_id", user.ID, "error", err)
		writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "重置密码失败")
		return
	}
	if err := q.DeleteEmailCode(ctx, sqlc.DeleteEmailCodeParams{Email: user.Email, Purpose: "reset"}); err != nil {
		logging.Event(ctx, slog.Default(), slog.LevelError, "identity.request.failed", "删除用户重置验证码失败", "module", "identity", "operation", "resetUserPassword", "user_id", user.ID, "error", err)
		writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "重置密码失败")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		logging.Event(ctx, slog.Default(), slog.LevelError, "identity.request.failed", "提交用户密码重置失败", "module", "identity", "operation", "resetUserPassword", "user_id", user.ID, "error", err)
		writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "重置密码失败")
		return
	}
	writeJSON(r.Context(), w, http.StatusOK, map[string]string{"password": password})
}

func (s *Service) createUser(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name     string   `json:"name"`
		Email    string   `json:"email"`
		Role     string   `json:"role"`
		Password string   `json:"password"`
		GroupIDs []string `json:"group_ids"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid_request", "请求格式无效")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if input.Name == "" || !validEmail(input.Email) || (input.Role != "admin" && input.Role != "user") {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid_request", "姓名、邮箱或角色无效")
		return
	}
	groupIDs, err := normalizeCreationGroups(input.GroupIDs)
	if err != nil {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if input.Role == "admin" && len(input.Password) < 12 {
		writeError(r.Context(), w, http.StatusBadRequest, "invalid_request", "管理员密码不能少于 12 个字符")
		return
	}
	actor, _ := UserFromContext(r.Context())
	result, writeErr := s.writer.CreateUser(r.Context(), member.CreateUser{
		ActorID: actor.ID, Name: input.Name, Email: input.Email,
		Role: input.Role, Password: input.Password, GroupIDs: groupIDs,
	})
	user, err := userFromMember(result), writeErr
	if err != nil {
		var dbError *pgconn.PgError
		switch {
		case errors.Is(err, member.ErrSeatsExceeded):
			writeError(r.Context(), w, http.StatusConflict, "seats_exceeded", member.ErrSeatsExceeded.Error())
		case errors.Is(err, member.ErrSeatsUnavailable):
			writeError(r.Context(), w, http.StatusServiceUnavailable, "seats_unavailable", member.ErrSeatsUnavailable.Error())
		case errors.Is(err, member.ErrWriterUnavailable):
			writeError(r.Context(), w, http.StatusServiceUnavailable, "member_writer_unavailable", "成员写入能力不可用")
		case errors.Is(err, errCreationGroupUnavailable), errors.Is(err, member.ErrGroupUnavailable):
			writeError(r.Context(), w, http.StatusBadRequest, "invalid_request", err.Error())
		case errors.As(err, &dbError) && dbError.Code == "23505" && dbError.ConstraintName == "users_email_active_key":
			writeError(r.Context(), w, http.StatusConflict, "user_exists", "该邮箱已存在")
		default:
			writeError(r.Context(), w, http.StatusInternalServerError, "server_error", "创建用户失败")
		}
		return
	}
	writeJSON(r.Context(), w, http.StatusCreated, user)
}
