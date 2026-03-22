package handler

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/taskflow/internal/runner"
	"github.com/chaitin/MonkeyCode/taskflow/internal/store"
)

type StatsHandler struct {
	store   *store.RedisStore
	manager *runner.Manager
}

func NewStatsHandler(s *store.RedisStore, m *runner.Manager) *StatsHandler {
	return &StatsHandler{store: s, manager: m}
}

func (h *StatsHandler) Get(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]interface{}{
		"code": 0,
		"data": map[string]interface{}{
			"online_host_count":     h.manager.Count(),
			"online_vm_count":       0,
			"online_task_count":     0,
			"online_terminal_count": 0,
		},
	})
}
