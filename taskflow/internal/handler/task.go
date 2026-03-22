package handler

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/taskflow/internal/store"
)

type TaskHandler struct {
	store *store.RedisStore
}

func NewTaskHandler(s *store.RedisStore) *TaskHandler {
	return &TaskHandler{store: s}
}

type CreateTaskRequest struct {
	VMID    string            `json:"vm_id"`
	UserID  string            `json:"user_id"`
	Text    string            `json:"text"`
	Model   string            `json:"model"`
	APIKey  string            `json:"api_key"`
	BaseURL string            `json:"base_url"`
	EnvVars map[string]string `json:"env_vars"`
}

func (h *TaskHandler) Create(c echo.Context) error {
	var req CreateTaskRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	if req.VMID == "" || req.UserID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "vm_id and user_id required")
	}

	taskID := uuid.New().String()

	task := &store.Task{
		ID:        taskID,
		VMID:      req.VMID,
		Status:    "pending",
		Agent:     "opencode",
		CreatedAt: time.Now().Unix(),
	}

	if err := h.store.SetTask(c.Request().Context(), task); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	if err := h.store.AddUserTask(c.Request().Context(), req.UserID, taskID); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"code": 0,
		"data": task,
	})
}

func (h *TaskHandler) Stop(c echo.Context) error {
	taskID := c.QueryParam("id")
	userID := c.QueryParam("user_id")

	if taskID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "id required")
	}

	task, err := h.store.GetTask(c.Request().Context(), taskID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "task not found")
	}

	task.Status = "stopped"
	if err := h.store.SetTask(c.Request().Context(), task); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	if userID != "" {
		h.store.RemoveUserTask(c.Request().Context(), userID, taskID)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"code":    0,
		"message": "task stopped",
	})
}

func (h *TaskHandler) Info(c echo.Context) error {
	taskID := c.QueryParam("id")
	if taskID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "id required")
	}

	task, err := h.store.GetTask(c.Request().Context(), taskID)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "task not found")
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"code": 0,
		"data": task,
	})
}

func (h *TaskHandler) List(c echo.Context) error {
	userID := c.QueryParam("user_id")
	if userID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "user_id required")
	}

	taskIDs, err := h.store.GetUserTasks(c.Request().Context(), userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	tasks := make([]*store.Task, 0)
	for _, id := range taskIDs {
		task, err := h.store.GetTask(c.Request().Context(), id)
		if err != nil {
			continue
		}
		tasks = append(tasks, task)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"code": 0,
		"data": tasks,
	})
}
