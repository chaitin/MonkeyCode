package server

import (
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"github.com/chaitin/MonkeyCode/taskflow/internal/handler"
)

type HTTPServer struct {
	*echo.Echo
}

func NewHTTPServer() *HTTPServer {
	e := echo.New()
	e.HideBanner = true
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORS())

	return &HTTPServer{e}
}

func RegisterHandlers(e *echo.Echo, h *handler.Handlers) {
	internal := e.Group("/internal")

	internal.GET("/host/list", h.Host.List)
	internal.POST("/host/is-online", h.Host.IsOnline)

	internal.POST("/vm", h.VM.Create)
	internal.DELETE("/vm", h.VM.Delete)
	internal.GET("/vm/list", h.VM.List)
	internal.GET("/vm/info", h.VM.Info)
	internal.POST("/vm/is-online", h.VM.IsOnline)

	internal.POST("/task", h.Task.Create)
	internal.DELETE("/task", h.Task.Stop)
	internal.GET("/task/info", h.Task.Info)
	internal.GET("/task/list", h.Task.List)

	internal.GET("/stats", h.Stats.Get)
}
