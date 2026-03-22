package handler

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/taskflow/internal/runner"
	"github.com/chaitin/MonkeyCode/taskflow/internal/store"
)

type VMHandler struct {
	store   *store.RedisStore
	manager *runner.Manager
}

func NewVMHandler(s *store.RedisStore, m *runner.Manager) *VMHandler {
	return &VMHandler{store: s, manager: m}
}

type CreateVMRequest struct {
	HostID   string            `json:"host_id"`
	UserID   string            `json:"user_id"`
	ImageURL string            `json:"image_url"`
	GitURL   string            `json:"git_url"`
	GitToken string            `json:"git_token"`
	Cores    int32             `json:"cores"`
	Memory   int64             `json:"memory"`
	EnvVars  map[string]string `json:"env_vars"`
	TTL      int64             `json:"ttl_seconds"`
}

func (h *VMHandler) Create(c echo.Context) error {
	var req CreateVMRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	if req.UserID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "user_id required")
	}

	vmID := uuid.New().String()

	vm := &store.VM{
		ID:        vmID,
		RunnerID:  req.HostID,
		UserID:    req.UserID,
		Status:    "pending",
		CreatedAt: time.Now().Unix(),
		ImageURL:  req.ImageURL,
		GitURL:    req.GitURL,
	}

	if err := h.store.SetVM(c.Request().Context(), vm); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	if err := h.store.AddUserVM(c.Request().Context(), req.UserID, vmID); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"code": 0,
		"data": vm,
	})
}

func (h *VMHandler) Delete(c echo.Context) error {
	vmID := c.QueryParam("id")
	userID := c.QueryParam("user_id")

	if vmID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "id required")
	}

	vm, err := h.store.GetVM(c.Request().Context(), vmID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "vm not found")
	}

	vm.Status = "deleted"
	if err := h.store.SetVM(c.Request().Context(), vm); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	if userID != "" {
		h.store.RemoveUserVM(c.Request().Context(), userID, vmID)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"code":    0,
		"message": "vm deleted",
	})
}

func (h *VMHandler) List(c echo.Context) error {
	userID := c.QueryParam("user_id")
	if userID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "user_id required")
	}

	vmIDs, err := h.store.GetUserVMs(c.Request().Context(), userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	vms := make([]*store.VM, 0)
	for _, id := range vmIDs {
		vm, err := h.store.GetVM(c.Request().Context(), id)
		if err != nil {
			continue
		}
		vms = append(vms, vm)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"code": 0,
		"data": vms,
	})
}

func (h *VMHandler) Info(c echo.Context) error {
	vmID := c.QueryParam("id")
	if vmID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "id required")
	}

	vm, err := h.store.GetVM(c.Request().Context(), vmID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "vm not found")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"code": 0,
		"data": vm,
	})
}

func (h *VMHandler) IsOnline(c echo.Context) error {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	onlineMap := make(map[string]bool)
	for _, id := range req.IDs {
		vm, err := h.store.GetVM(c.Request().Context(), id)
		onlineMap[id] = err == nil && vm.Status == "running"
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"code": 0,
		"data": map[string]interface{}{
			"online_map": onlineMap,
		},
	})
}
