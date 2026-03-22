package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	dockerclient "github.com/docker/docker/client"

	grpcclient "github.com/chaitin/MonkeyCode/runner/internal/client"
	"github.com/chaitin/MonkeyCode/runner/internal/config"
	"github.com/chaitin/MonkeyCode/runner/internal/docker"
	"github.com/chaitin/MonkeyCode/runner/internal/task"
	"github.com/chaitin/MonkeyCode/runner/internal/terminal"
	"github.com/chaitin/MonkeyCode/runner/internal/vm"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	cfg := config.Load()
	if cfg.Token == "" {
		logger.Error("TOKEN environment variable is required")
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dockerMgr, dockerCli, err := initDocker(logger)
	if err != nil {
		logger.Error("failed to initialize docker", "error", err)
		os.Exit(1)
	}
	defer dockerMgr.Close()

	vmMgr := vm.NewManager(dockerMgr)
	termMgr := terminal.NewManager(logger, dockerCli)
	taskMgr := task.NewManager()
	taskExecutor := task.NewExecutor(taskMgr, nil, logger)

	grpcClient, err := grpcclient.New(cfg.GRPCAddr, logger)
	if err != nil {
		logger.Error("failed to connect to taskflow", "error", err)
		os.Exit(1)
	}
	defer grpcClient.Close()

	hostname, _ := os.Hostname()
	ip := getLocalIP()

	runnerID, err := grpcClient.Register(ctx, cfg.Token, hostname, ip, 8, 16384, 100000)
	if err != nil {
		logger.Error("failed to register", "error", err)
		os.Exit(1)
	}

	logger.Info("runner registered", "runner_id", runnerID, "hostname", hostname, "ip", ip)

	go startHeartbeat(ctx, grpcClient, runnerID, vmMgr, taskExecutor, logger)
	go startHTTPServer(ctx, vmMgr, termMgr, taskMgr, taskExecutor, logger)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	logger.Info("shutting down runner")
	cancel()
	taskExecutor.StopAll()
	termMgr.CloseAll()
}

func initDocker(logger *slog.Logger) (*docker.Manager, *dockerclient.Client, error) {
	dockerMgr, err := docker.NewManager(logger)
	if err != nil {
		return nil, nil, err
	}

	ctx := context.Background()
	if err := dockerMgr.Ping(ctx); err != nil {
		return nil, nil, err
	}

	cli, err := dockerclient.NewClientWithOpts(dockerclient.FromEnv, dockerclient.WithAPIVersionNegotiation())
	if err != nil {
		return nil, nil, err
	}

	return dockerMgr, cli, nil
}

func startHeartbeat(ctx context.Context, grpcClient *grpcclient.Client, runnerID string, vmMgr *vm.Manager, taskExecutor *task.Executor, logger *slog.Logger) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runningVMs := int32(vmMgr.RunningCount())
			runningTasks := int32(taskExecutor.RunningCount())

			if err := grpcClient.Heartbeat(ctx, runnerID, runningVMs, runningTasks); err != nil {
				logger.Error("heartbeat failed", "error", err)
			} else {
				logger.Debug("heartbeat sent", "runner_id", runnerID, "vms", runningVMs, "tasks", runningTasks)
			}
		}
	}
}

func startHTTPServer(ctx context.Context, vmMgr *vm.Manager, termMgr *terminal.Manager, taskMgr *task.Manager, taskExecutor *task.Executor, logger *slog.Logger) {
	wsHandler := terminal.NewWebSocketHandler(termMgr, logger)

	http.HandleFunc("/terminal", func(w http.ResponseWriter, r *http.Request) {
		vmID := r.URL.Query().Get("vm_id")
		if vmID == "" {
			http.Error(w, "vm_id required", http.StatusBadRequest)
			return
		}

		vm, err := vmMgr.Get(vmID)
		if err != nil {
			http.Error(w, "vm not found", http.StatusNotFound)
			return
		}

		wsConn, err := wsHandler.Upgrade(w, r)
		if err != nil {
			logger.Error("websocket upgrade failed", "error", err)
			return
		}

		term, err := termMgr.Create(ctx, vmID, vmID, vm.ContainerID, nil, &terminal.Resize{Cols: 80, Rows: 24})
		if err != nil {
			logger.Error("terminal create failed", "error", err)
			wsConn.Close()
			return
		}

		wsHandler.HandleTerminal(ctx, wsConn, term)
	})

	http.HandleFunc("/task", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			VMID   string `json:"vm_id"`
			UserID string `json:"user_id"`
			Text   string `json:"text"`
			Model  string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		task, err := taskMgr.Create(task.CreateOptions{
			VMID:   req.VMID,
			UserID: req.UserID,
			Text:   req.Text,
			Model:  req.Model,
		})
		if err != nil {
			http.Error(w, "failed to create task", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(task)
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	server := &http.Server{
		Addr:    ":8080",
		Handler: nil,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(shutdownCtx)
	}()

	logger.Info("starting HTTP server", "addr", ":8080")
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("http server error", "error", err)
	}
}

func getLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return "unknown"
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() != nil {
				return ipnet.IP.String()
			}
		}
	}
	return "unknown"
}
