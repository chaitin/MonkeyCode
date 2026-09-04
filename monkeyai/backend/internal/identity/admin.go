package identity

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAdmin(router chi.Router) {
	router.Get("/me", func(w http.ResponseWriter, r *http.Request) {
		user, _ := UserFromContext(r.Context())
		writeJSON(w, http.StatusOK, user)
	})
	router.Get("/users", func(w http.ResponseWriter, r *http.Request) {
		users, err := s.listUsers(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "读取用户失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"users": users})
	})
	router.Post("/users", s.createUser)
	router.Patch("/users/{userID}", s.patchUser)
}

func (s *Service) RegisterAgent(router chi.Router) {
	router.Get("/me", func(w http.ResponseWriter, r *http.Request) {
		user, _ := UserFromContext(r.Context())
		writeJSON(w, http.StatusOK, user)
	})
}

func (s *Service) patchUser(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name     string `json:"name"`
		Role     string `json:"role"`
		Status   string `json:"status"`
		Password string `json:"password"`
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
	target, err := s.userByID(r.Context(), chi.URLParam(r, "userID"))
	if err != nil {
		writeError(w, http.StatusNotFound, "user_not_found", "用户不存在")
		return
	}
	passwordHash := ""
	if target.Role != "admin" && input.Role == "admin" {
		if len(input.Password) < 12 {
			writeError(w, http.StatusBadRequest, "password_required", "提升为管理员时必须设置至少 12 个字符的密码")
			return
		}
		passwordHash, err = hashPassword(input.Password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "更新用户失败")
			return
		}
	}
	user, err := s.updateUser(r.Context(), chi.URLParam(r, "userID"), input.Name, input.Role, input.Status, passwordHash)
	if err != nil {
		writeError(w, http.StatusNotFound, "user_not_found", "用户不存在")
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Service) createUser(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Role     string `json:"role"`
		Password string `json:"password"`
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
	passwordHash := ""
	if input.Role == "admin" {
		if len(input.Password) < 12 {
			writeError(w, http.StatusBadRequest, "invalid_request", "管理员密码不能少于 12 个字符")
			return
		}
		var err error
		passwordHash, err = hashPassword(input.Password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "server_error", "创建用户失败")
			return
		}
	}
	user, err := s.insertUser(r.Context(), input.Name, input.Email, input.Role, passwordHash)
	if err != nil {
		writeError(w, http.StatusConflict, "user_exists", "该邮箱已存在")
		return
	}
	writeJSON(w, http.StatusCreated, user)
}
