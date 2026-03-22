package main

import (
	"context"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/taskflow/internal/config"
	"github.com/chaitin/MonkeyCode/taskflow/internal/handler"
	"github.com/chaitin/MonkeyCode/taskflow/internal/runner"
	"github.com/chaitin/MonkeyCode/taskflow/internal/server"
	"github.com/chaitin/MonkeyCode/taskflow/internal/store"
	pb "github.com/chaitin/MonkeyCode/taskflow/pkg/proto"

	"google.golang.org/grpc"
)

func main() {
	cfg, err := config.Load("config.yaml")
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	redisClient := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})

	ctx := context.Background()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}

	redisStore := store.NewRedisStore(redisClient)
	runnerManager := runner.NewManager()

	grpcServer := server.NewGRPCServer(redisStore, runnerManager, logger)
	grpcListener, err := net.Listen("tcp", cfg.Server.GRPCAddr)
	if err != nil {
		log.Fatalf("Failed to listen on gRPC address: %v", err)
	}

	grpcSrv := grpc.NewServer()
	pb.RegisterRunnerServiceServer(grpcSrv, grpcServer)

	go func() {
		logger.Info("Starting gRPC server", "addr", cfg.Server.GRPCAddr)
		if err := grpcSrv.Serve(grpcListener); err != nil {
			log.Fatalf("Failed to serve gRPC: %v", err)
		}
	}()

	handlers := handler.NewHandlers(redisStore, runnerManager)
	httpServer := server.NewHTTPServer()
	server.RegisterHandlers(httpServer.Echo, handlers)

	go func() {
		logger.Info("Starting HTTP server", "addr", cfg.Server.HTTPAddr)
		if err := httpServer.Start(cfg.Server.HTTPAddr); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to serve HTTP: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	logger.Info("Shutting down TaskFlow server...")

	grpcSrv.GracefulStop()
	ctx, cancel := context.WithTimeout(context.Background(), 5)
	defer cancel()
	httpServer.Shutdown(ctx)

	logger.Info("TaskFlow server stopped")
}
