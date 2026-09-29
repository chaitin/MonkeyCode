package identity

import (
	"encoding/json"
	"errors"
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
		writeJSON(w, http.StatusOK, user)
	})
	router.Get("/users", func(w http.ResponseWriter, r *http.Request) {
		users, err := s.listUsers(r.Context())
		if err != nil {
			slog.ErrorContext(r.Context(), "读取用户列表失败", "error", err)
			writeError(w, http.StatusInternalServerError, "server_error", "读取用户失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"users": users})
	})
	router.Post("/users", s.createUser)
	router.Patch("/users/{userID}", s.patchUser)
	router.Post("/users/{userID}/reset-password", s.resetUserPassword)
}

func (s *Service) RegisterAgent(router chi.Router) {
	router.Get("/users", s.searchUsers)
	router.Get("/me", func(w http.ResponseWriter, r *http.Request) {
		user, _ := UserFromContext(r.Context())
		writeJSON(w, http.StatusOK, user)
	})
}

func (s *Service) patchUser(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name   string `json:"name"`
		Role   string `json:"role"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "请求格式无效")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || (input.Role != "admin" && input.Role != "user") || (input.Status != "active" && input.Status != "disabled") {
		writeError(w, http.StatusBadRequest, "invalid_request", "name、role 或 status 无效")
		return
	}
	current, _ := UserFromContext(r.Context())
	if current.ID == chi.URLParam(r, "userID") && (input.Role != "admin" || input.Status != "active") {
		writeError(w, http.StatusConflict, "cannot_disable_self", "不能停用自己或移除自己的管理员角色")
		return
	}
	user, err := s.updateUser(r.Context(), chi.URLParam(r, "userID"), input.Name, input.Role, input.Status, "")
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound), errors.Is(err, pgx.ErrNoRows):
			writeError(w, http.StatusNotFound, "user_not_found", "用户不存在")
		case errors.Is(err, member.ErrSeatsExceeded):
			writeError(w, http.StatusConflict, "seats_exceeded", "成员席位已满")
		case errors.Is(err, member.ErrSeatsUnavailable), errors.Is(err, member.ErrWriterUnavailable):
			writeError(w, http.StatusServiceUnavailable, "member_writer_unavailable", "成员写入能力不可用")
		default:
			slog.ErrorContext(r.Context(), "更新用户失败", "user_id", chi.URLParam(r, "userID"), "error", err)
			writeError(w, http.StatusInternalServerError, "server_error", "更新用户失败")
		}
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Service) resetUserPassword(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	password, err := generatePassword()
	if err != nil {
		slog.ErrorContext(r.Context(), "生成重置密码失败", "user_id", chi.URLParam(r, "userID"), "error", err)
		writeError(w, http.StatusInternalServerError, "server_error", "生成密码失败")
		return
	}
	hash, err := hashPassword(password)
	if err != nil {
		slog.ErrorContext(r.Context(), "重置用户密码失败", "user_id", chi.URLParam(r, "userID"), "error", err)
		writeError(w, http.StatusInternalServerError, "server_error", "重置密码失败")
		return
	}
	ctx := r.Context()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		slog.ErrorContext(r.Context(), "重置用户密码失败", "user_id", chi.URLParam(r, "userID"), "error", err)
		writeError(w, http.StatusInternalServerError, "server_error", "重置密码失败")
		return
	}
	defer func() {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) && ctx.Err() == nil {
			slog.ErrorContext(ctx, "回滚重置用户密码事务失败", "user_id", chi.URLParam(r, "userID"), "error", err)
		}
	}()
	q := sqlc.New(tx)
	user, err := q.GetUser(ctx, chi.URLParam(r, "userID"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "user_not_found", "用户不存在")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "重置用户密码失败", "user_id", chi.URLParam(r, "userID"), "error", err)
		writeError(w, http.StatusInternalServerError, "server_error", "重置密码失败")
		return
	}
	err = s.writer.ResetUserPassword(ctx, tx, user.ID, hash)
	if err != nil {
		if errors.Is(err, member.ErrWriterUnavailable) {
			writeError(w, http.StatusServiceUnavailable, "member_writer_unavailable", "成员写入能力不可用")
		} else {
			slog.ErrorContext(ctx, "更新用户密码失败", "user_id", user.ID, "error", err)
			writeError(w, http.StatusInternalServerError, "server_error", "重置密码失败")
		}
		return
	}
	if err := revokePasswordAccess(ctx, q, user.ID, user.Email); err != nil {
		slog.ErrorContext(ctx, "撤销用户旧凭据失败", "user_id", user.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "server_error", "重置密码失败")
		return
	}
	if err := q.DeleteEmailCode(ctx, sqlc.DeleteEmailCodeParams{Email: user.Email, Purpose: "reset"}); err != nil {
		slog.ErrorContext(ctx, "删除用户重置验证码失败", "user_id", user.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "server_error", "重置密码失败")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		slog.ErrorContext(ctx, "提交用户密码重置失败", "user_id", user.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "server_error", "重置密码失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"password": password})
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
		writeError(w, http.StatusBadRequest, "invalid_request", "请求格式无效")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if input.Name == "" || !validEmail(input.Email) || (input.Role != "admin" && input.Role != "user") {
		writeError(w, http.StatusBadRequest, "invalid_request", "姓名、邮箱或角色无效")
		return
	}
	groupIDs, err := normalizeCreationGroups(input.GroupIDs)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if input.Role == "admin" && len(input.Password) < 12 {
		writeError(w, http.StatusBadRequest, "invalid_request", "管理员密码不能少于 12 个字符")
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
			writeError(w, http.StatusConflict, "seats_exceeded", "成员席位已满")
		case errors.Is(err, member.ErrSeatsUnavailable), errors.Is(err, member.ErrWriterUnavailable):
			writeError(w, http.StatusServiceUnavailable, "member_writer_unavailable", "成员写入能力不可用")
		case errors.Is(err, errCreationGroupUnavailable), errors.Is(err, member.ErrGroupUnavailable):
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		case errors.As(err, &dbError) && dbError.Code == "23505" && dbError.ConstraintName == "users_email_active_key":
			writeError(w, http.StatusConflict, "user_exists", "该邮箱已存在")
		default:
			writeError(w, http.StatusInternalServerError, "server_error", "创建用户失败")
		}
		return
	}
	writeJSON(w, http.StatusCreated, user)
}
