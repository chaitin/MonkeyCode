package main

import (
	"context"

	"github.com/google/wire"
	"github.com/labstack/echo/v4"

	"github.com/GoYoko/web"

	"github.com/chaitin/MonkeyCode/backend"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/docs"
	"github.com/chaitin/MonkeyCode/backend/internal"
	"github.com/chaitin/MonkeyCode/backend/pkg"
	"github.com/chaitin/MonkeyCode/backend/pkg/service"
	"github.com/chaitin/MonkeyCode/backend/pkg/store"
)

// @title MonkeyCode API
// @version 1.0
// @description MonkeyCode API
func main() {
	s, err := newServer()
	if err != nil {
		panic(err)
	}

	s.version.Print()
	s.logger.With("config", s.config).Debug("config")

	if s.config.Debug {
		s.web.Swagger("MonkeyCode API", "/reference", string(docs.SwaggerJSON), web.WithBasicAuth("mc", "mc88"))
	}

	// 设置Socket.IO路由
	s.web.Echo().Any("/socket.io/*", echo.WrapHandler(s.socketH.GetServer().HttpHandler()))
	s.logger.Info("Socket.IO server configured", "path", "/socket.io/")

	s.web.PrintRoutes()

	if err := store.MigrateSQL(s.config, s.logger); err != nil {
		panic(err)
	}

	if err := s.userV1.InitAdmin(); err != nil {
		panic(err)
	}

	if err := s.report.ReportInstallation(); err != nil {
		panic(err)
	}

	svc := service.NewService(service.WithPprof())
	svc.Add(s)
	if err := svc.Run(); err != nil {
		panic(err)
	}
}

// Name implements service.Servicer.
func (s *Server) Name() string {
	return "Server"
}

// Start implements service.Servicer.
func (s *Server) Start() error {
	return s.web.Run(s.config.Server.Addr)
}

// Stop implements service.Servicer.
func (s *Server) Stop() error {
	return s.web.Echo().Shutdown(context.Background())
}

var AppSet = wire.NewSet(
	wire.FieldsOf(new(*config.Config), "Logger"),
	config.Init,
	pkg.Provider,
	internal.Provider,
	backend.Provider,
)
