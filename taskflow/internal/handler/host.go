package handler

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/chaitin/MonkeyCode/taskflow/internal/store"
)

type HostHandler struct {
	store *store.RedisStore
}

func NewHostHandler(s *store.RedisStore) *HostHandler {
	return &HostHandler{store: s}
}

func (h *HostHandler) List(c echo.Context) error {
	userID := c.QueryParam("user_id")
	if userID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "user_id required")
	}

	runnerIDs, err := h.store.GetUserRunners(c.Request().Context(), userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	runners := make(map[string]*store.Runner)
	for _, id := range runnerIDs {
		runner, err := h.store.GetRunner(c.Request().Context(), id)
		if err != nil {
			continue
		}
		runners[id] = runner
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"code": 0,
		"data": runners,
	})
}

func (h *HostHandler) IsOnline(c echo.Context) error {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	onlineMap := make(map[string]bool)
	for _, id := range req.IDs {
		_, err := h.store.GetRunner(c.Request().Context(), id)
		onlineMap[id] = err == nil
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"code": 0,
		"data": map[string]interface{}{
			"online_map": onlineMap,
		},
	})
}
