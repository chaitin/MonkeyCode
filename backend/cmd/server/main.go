package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/pkg"
	"github.com/chaitin/MonkeyCode/backend/pkg/service"
	"github.com/chaitin/MonkeyCode/backend/pkg/store"
)

func main() {
	// 初始化配置
	cfg, err := config.Init("./config/server")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to load config: %v\n", err)
		os.Exit(1)
	}

	// 创建 DI 容器
	injector := do.New()

	// 注入配置
	do.ProvideValue(injector, cfg)

	// 注册基础设施
	if err := pkg.RegisterInfra(injector); err != nil {
		fmt.Fprintf(os.Stderr, "failed to register infra: %v\n", err)
		os.Exit(1)
	}

	// 注册业务模块
	if err := biz.RegisterAll(injector); err != nil {
		fmt.Fprintf(os.Stderr, "failed to register biz: %v\n", err)
		os.Exit(1)
	}

	l := do.MustInvoke[*slog.Logger](injector)
	l.With("config", cfg).Debug("print config")

	// 运行数据库迁移
	if err := store.MigrateSQL(cfg, l); err != nil {
		l.Warn("database migration warning", "error", err)
	}

	// 获取 web 实例并启动服务
	w := do.MustInvoke[*web.Web](injector)
	w.PrintRoutes()
	svc := service.NewService(
		service.WithPprof(),
		service.WithLogger(l),
	)
	svc.Add(&server{w: w, addr: cfg.Server.Addr})

	l.Info("starting server", "addr", cfg.Server.Addr)
	if err := svc.Run(); err != nil {
		l.Error("server error", "error", err)
	}
}

type server struct {
	w    *web.Web
	addr string
}

func (s *server) Name() string { return "MonkeyCode Service" }
func (s *server) Start() error { return s.w.Run(s.addr) }
func (s *server) Stop() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return s.w.Echo().Shutdown(ctx)
}
