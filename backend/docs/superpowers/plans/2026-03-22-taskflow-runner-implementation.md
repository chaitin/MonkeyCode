# TaskFlow + Runner 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 TaskFlow 服务和 Runner 服务，为 MonkeyCode 提供完整的任务执行和虚拟机管理能力。

**Architecture:** TaskFlow 作为中心调度服务，提供 HTTP API 给 MonkeyCode 后端调用，提供 gRPC 服务给 Runner 连接。Runner 部署在 Linux 服务器上，管理 Docker 容器，执行 OpenCode AI 编码任务。

**Tech Stack:** Go 1.25+, Echo (HTTP), gRPC, Redis, Docker SDK, OpenCode CLI

---

## 文件结构

### TaskFlow 服务

```
taskflow/
├── cmd/
│   └── server/
│       └── main.go
├── internal/
│   ├── config/
│   │   └── config.go
│   ├── server/
│   │   ├── http.go
│   │   └── grpc.go
│   ├── handler/
│   │   ├── host.go
│   │   ├── vm.go
│   │   ├── task.go
│   │   ├── file.go
│   │   ├── portforward.go
│   │   └── stats.go
│   ├── scheduler/
│   │   └── scheduler.go
│   ├── runner/
│   │   └── manager.go
│   └── store/
│       └── redis.go
├── pkg/
│   └── proto/
│       └── taskflow.proto
├── go.mod
├── Makefile
└── config.yaml
```

### Runner 服务

```
runner/
├── cmd/
│   └── runner/
│       └── main.go
├── internal/
│   ├── config/
│   │   └── config.go
│   ├── client/
│   │   └── grpc.go
│   ├── docker/
│   │   ├── manager.go
│   │   ├── container.go
│   │   ├── image.go
│   │   └── network.go
│   ├── terminal/
│   │   ├── pty.go
│   │   └── websocket.go
│   ├── agent/
│   │   ├── opencode.go
│   │   └── task.go
│   ├── file/
│   │   └── manager.go
│   └── portforward/
│       └── forward.go
├── scripts/
│   └── install.sh
├── go.mod
├── Makefile
└── config.yaml
```

---

## 阶段 1: 基础框架

### Task 1.1: 创建 TaskFlow 项目结构

**Files:**
- Create: `taskflow/go.mod`
- Create: `taskflow/Makefile`
- Create: `taskflow/config.yaml`
- Create: `taskflow/cmd/server/main.go`

- [ ] **Step 1: 创建项目目录结构**

```bash
mkdir -p taskflow/{cmd/server,internal/{config,server,handler,scheduler,runner,store},pkg/proto}
cd taskflow
```

- [ ] **Step 2: 初始化 Go 模块**

```bash
go mod init github.com/chaitin/MonkeyCode/taskflow
```

- [ ] **Step 3: 创建 Makefile**

```makefile
.PHONY: build run test proto

build:
	go build -o bin/taskflow ./cmd/server

run:
	go run ./cmd/server

test:
	go test ./... -v

proto:
	protoc --go_out=. --go-grpc_out=. pkg/proto/taskflow.proto
```

- [ ] **Step 4: 创建配置文件模板**

```yaml
server:
  http_addr: ":8888"
  grpc_addr: ":50051"

redis:
  addr: "localhost:6379"
  password: ""
  db: 0

log:
  level: "info"
```

- [ ] **Step 5: 创建入口文件**

```go
package main

import (
	"log"
	
	"github.com/chaitin/MonkeyCode/taskflow/internal/config"
)

func main() {
	cfg, err := config.Load("config.yaml")
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	
	log.Printf("Starting TaskFlow server...")
	log.Printf("Config: %+v", cfg)
}
```

- [ ] **Step 6: 提交代码**

```bash
git add taskflow/
git commit -m "feat(taskflow): initialize project structure"
```

---

### Task 1.2: 实现配置管理

**Files:**
- Create: `taskflow/internal/config/config.go`
- Test: `taskflow/internal/config/config_test.go`

- [ ] **Step 1: 编写配置加载测试**

```go
package config

import (
	"os"
	"testing"
)

func TestLoad(t *testing.T) {
	content := `
server:
  http_addr: ":9090"
  grpc_addr: ":50052"
redis:
  addr: "localhost:6380"
log:
  level: "debug"
`
	tmpFile, err := os.CreateTemp("", "config-*.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile.Name())
	
	if _, err := tmpFile.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	tmpFile.Close()
	
	cfg, err := Load(tmpFile.Name())
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	
	if cfg.Server.HTTPAddr != ":9090" {
		t.Errorf("expected HTTPAddr :9090, got %s", cfg.Server.HTTPAddr)
	}
	if cfg.Server.GRPCAddr != ":50052" {
		t.Errorf("expected GRPCAddr :50052, got %s", cfg.Server.GRPCAddr)
	}
	if cfg.Redis.Addr != "localhost:6380" {
		t.Errorf("expected Redis.Addr localhost:6380, got %s", cfg.Redis.Addr)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd taskflow && go test ./internal/config/... -v
```
Expected: FAIL - config.Load not defined

- [ ] **Step 3: 实现配置结构体和加载函数**

```go
package config

import (
	"os"
	
	"gopkg.in/yaml.v3"
)

type Config struct {
	Server ServerConfig `yaml:"server"`
	Redis  RedisConfig  `yaml:"redis"`
	Log    LogConfig    `yaml:"log"`
}

type ServerConfig struct {
	HTTPAddr string `yaml:"http_addr"`
	GRPCAddr string `yaml:"grpc_addr"`
}

type RedisConfig struct {
	Addr     string `yaml:"addr"`
	Password string `yaml:"password"`
	DB       int    `yaml:"db"`
}

type LogConfig struct {
	Level string `yaml:"level"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	
	return &cfg, nil
}
```

- [ ] **Step 4: 添加依赖并运行测试**

```bash
cd taskflow && go get gopkg.in/yaml.v3
go test ./internal/config/... -v
```
Expected: PASS

- [ ] **Step 5: 提交代码**

```bash
git add taskflow/internal/config/
git commit -m "feat(taskflow): add config management"
```

---

### Task 1.3: 实现 Redis 存储

**Files:**
- Create: `taskflow/internal/store/redis.go`
- Test: `taskflow/internal/store/redis_test.go`

- [ ] **Step 1: 编写 Redis 存储测试**

```go
package store

import (
	"context"
	"testing"
	"time"
	
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestRunnerStore(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer mr.Close()
	
	client := redis.NewClient(&redis.Options{
		Addr: mr.Addr(),
	})
	
	store := NewRedisStore(client)
	ctx := context.Background()
	
	runner := &Runner{
		ID:       "runner-1",
		Hostname: "test-server",
		IP:       "192.168.1.100",
		Status:   "online",
	}
	
	err = store.RegisterRunner(ctx, runner, 60*time.Second)
	if err != nil {
		t.Fatalf("RegisterRunner failed: %v", err)
	}
	
	got, err := store.GetRunner(ctx, "runner-1")
	if err != nil {
		t.Fatalf("GetRunner failed: %v", err)
	}
	
	if got.ID != runner.ID {
		t.Errorf("expected ID %s, got %s", runner.ID, got.ID)
	}
}
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd taskflow && go test ./internal/store/... -v
```
Expected: FAIL

- [ ] **Step 3: 实现 Redis 存储结构**

```go
package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
	
	"github.com/redis/go-redis/v9"
)

type Runner struct {
	ID           string            `json:"id"`
	Hostname     string            `json:"hostname"`
	IP           string            `json:"ip"`
	Status       string            `json:"status"`
	LastSeen     int64             `json:"last_seen"`
	Capacity     map[string]int64  `json:"capacity"`
	UserID       string            `json:"user_id"`
}

type VM struct {
	ID           string `json:"id"`
	RunnerID     string `json:"runner_id"`
	UserID       string `json:"user_id"`
	Status       string `json:"status"`
	ContainerID  string `json:"container_id"`
	CreatedAt    int64  `json:"created_at"`
}

type Task struct {
	ID        string `json:"id"`
	VMID      string `json:"vm_id"`
	Status    string `json:"status"`
	Agent     string `json:"agent"`
	CreatedAt int64  `json:"created_at"`
}

type RedisStore struct {
	client *redis.Client
}

func NewRedisStore(client *redis.Client) *RedisStore {
	return &RedisStore{client: client}
}

func (s *RedisStore) RegisterRunner(ctx context.Context, runner *Runner, ttl time.Duration) error {
	data, err := json.Marshal(runner)
	if err != nil {
		return err
	}
	
	key := fmt.Sprintf("runner:%s", runner.ID)
	return s.client.Set(ctx, key, data, ttl).Err()
}

func (s *RedisStore) GetRunner(ctx context.Context, id string) (*Runner, error) {
	key := fmt.Sprintf("runner:%s", id)
	data, err := s.client.Get(ctx, key).Bytes()
	if err != nil {
		return nil, err
	}
	
	var runner Runner
	if err := json.Unmarshal(data, &runner); err != nil {
		return nil, err
	}
	
	return &runner, nil
}

func (s *RedisStore) SetVM(ctx context.Context, vm *VM) error {
	data, err := json.Marshal(vm)
	if err != nil {
		return err
	}
	
	key := fmt.Sprintf("vm:%s", vm.ID)
	return s.client.Set(ctx, key, data, 0).Err()
}

func (s *RedisStore) GetVM(ctx context.Context, id string) (*VM, error) {
	key := fmt.Sprintf("vm:%s", id)
	data, err := s.client.Get(ctx, key).Bytes()
	if err != nil {
		return nil, err
	}
	
	var vm VM
	if err := json.Unmarshal(data, &vm); err != nil {
		return nil, err
	}
	
	return &vm, nil
}

func (s *RedisStore) DeleteVM(ctx context.Context, id string) error {
	key := fmt.Sprintf("vm:%s", id)
	return s.client.Del(ctx, key).Err()
}

func (s *RedisStore) SetTask(ctx context.Context, task *Task) error {
	data, err := json.Marshal(task)
	if err != nil {
		return err
	}
	
	key := fmt.Sprintf("task:%s", task.ID)
	return s.client.Set(ctx, key, data, 0).Err()
}

func (s *RedisStore) GetTask(ctx context.Context, id string) (*Task, error) {
	key := fmt.Sprintf("task:%s", id)
	data, err := s.client.Get(ctx, key).Bytes()
	if err != nil {
		return nil, err
	}
	
	var task Task
	if err := json.Unmarshal(data, &task); err != nil {
		return nil, err
	}
	
	return &task, nil
}

func (s *RedisStore) AddUserRunner(ctx context.Context, userID, runnerID string) error {
	key := fmt.Sprintf("user:runners:%s", userID)
	return s.client.SAdd(ctx, key, runnerID).Err()
}

func (s *RedisStore) GetUserRunners(ctx context.Context, userID string) ([]string, error) {
	key := fmt.Sprintf("user:runners:%s", userID)
	return s.client.SMembers(ctx, key).Result()
}

func (s *RedisStore) AddUserVM(ctx context.Context, userID, vmID string) error {
	key := fmt.Sprintf("user:vms:%s", userID)
	return s.client.SAdd(ctx, key, vmID).Err()
}

func (s *RedisStore) GetUserVMs(ctx context.Context, userID string) ([]string, error) {
	key := fmt.Sprintf("user:vms:%s", userID)
	return s.client.SMembers(ctx, key).Result()
}
```

- [ ] **Step 4: 添加依赖并运行测试**

```bash
cd taskflow && go get github.com/redis/go-redis/v9 github.com/alicebob/miniredis/v2
go test ./internal/store/... -v
```
Expected: PASS

- [ ] **Step 5: 提交代码**

```bash
git add taskflow/internal/store/
git commit -m "feat(taskflow): add redis store implementation"
```

---

### Task 1.4: 定义 gRPC 协议

**Files:**
- Create: `taskflow/pkg/proto/taskflow.proto`
- Create: `taskflow/pkg/proto/taskflow.pb.go` (generated)
- Create: `taskflow/pkg/proto/taskflow_grpc.pb.go` (generated)

- [ ] **Step 1: 创建 Proto 文件**

```protobuf
syntax = "proto3";

package taskflow;

option go_package = "github.com/chaitin/MonkeyCode/taskflow/pkg/proto;proto";

service RunnerService {
    rpc Register(RegisterRequest) returns (RegisterResponse);
    rpc Heartbeat(HeartbeatRequest) returns (HeartbeatResponse);
    rpc CreateVM(CreateVMRequest) returns (CreateVMResponse);
    rpc DeleteVM(DeleteVMRequest) returns (DeleteVMResponse);
    rpc ListVMs(ListVMsRequest) returns (ListVMsResponse);
    rpc GetVMInfo(GetVMInfoRequest) returns (GetVMInfoResponse);
    rpc CreateTask(CreateTaskRequest) returns (CreateTaskResponse);
    rpc StopTask(StopTaskRequest) returns (StopTaskResponse);
    rpc TerminalStream(stream TerminalData) returns (stream TerminalData);
    rpc ReportStream(ReportRequest) returns (stream ReportEntry);
}

message RegisterRequest {
    string token = 1;
    string hostname = 2;
    string ip = 3;
    int32 cores = 4;
    int64 memory = 5;
    int64 disk = 6;
}

message RegisterResponse {
    string runner_id = 1;
    bool success = 2;
    string message = 3;
}

message HeartbeatRequest {
    string runner_id = 1;
    int64 timestamp = 2;
    int32 running_vms = 3;
    int32 running_tasks = 4;
}

message HeartbeatResponse {
    bool success = 1;
}

message CreateVMRequest {
    string vm_id = 1;
    string user_id = 2;
    string image_url = 3;
    string git_url = 4;
    string git_token = 5;
    int32 cores = 6;
    int64 memory = 7;
    map<string, string> env_vars = 8;
    int64 ttl_seconds = 9;
}

message CreateVMResponse {
    string vm_id = 1;
    string container_id = 2;
    bool success = 3;
    string message = 4;
}

message DeleteVMRequest {
    string vm_id = 1;
    string runner_id = 2;
}

message DeleteVMResponse {
    bool success = 1;
    string message = 2;
}

message ListVMsRequest {
    string runner_id = 1;
}

message ListVMsResponse {
    repeated VMInfo vms = 1;
}

message GetVMInfoRequest {
    string vm_id = 1;
}

message GetVMInfoResponse {
    VMInfo vm = 1;
}

message VMInfo {
    string id = 1;
    string container_id = 2;
    string status = 3;
    int64 created_at = 4;
}

message CreateTaskRequest {
    string task_id = 1;
    string vm_id = 2;
    string text = 3;
    string model = 4;
    string api_key = 5;
    string base_url = 6;
    map<string, string> env_vars = 7;
}

message CreateTaskResponse {
    bool success = 1;
    string message = 2;
}

message StopTaskRequest {
    string task_id = 1;
    string vm_id = 2;
}

message StopTaskResponse {
    bool success = 1;
    string message = 2;
}

message TerminalData {
    string vm_id = 1;
    string terminal_id = 2;
    bytes data = 3;
    TerminalResize resize = 4;
}

message TerminalResize {
    uint32 cols = 1;
    uint32 rows = 2;
}

message ReportRequest {
    string task_id = 1;
}

message ReportEntry {
    string task_id = 1;
    string source = 2;
    int64 timestamp = 3;
    bytes data = 4;
}
```

- [ ] **Step 2: 安装 protoc 和 Go 插件**

```bash
# 安装 protoc (如果未安装)
# macOS: brew install protobuf
# Linux: apt install protobuf-compiler

# 安装 Go 插件
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
```

- [ ] **Step 3: 生成 Go 代码**

```bash
cd taskflow
protoc --go_out=. --go-grpc_out=. pkg/proto/taskflow.proto
```

- [ ] **Step 4: 添加 gRPC 依赖**

```bash
cd taskflow
go get google.golang.org/grpc google.golang.org/protobuf
```

- [ ] **Step 5: 提交代码**

```bash
git add taskflow/pkg/proto/
git commit -m "feat(taskflow): add gRPC protocol definition"
```

---

### Task 1.5: 实现 gRPC Server

**Files:**
- Create: `taskflow/internal/server/grpc.go`
- Create: `taskflow/internal/runner/manager.go`
- Test: `taskflow/internal/server/grpc_test.go`

- [ ] **Step 1: 实现 Runner 管理器**

```go
package runner

import (
	"context"
	"sync"
	"time"
	
	"github.com/chaitin/MonkeyCode/taskflow/internal/store"
)

type RunnerConnection struct {
	ID       string
	UserID   string
	Stream   chan interface{}
	LastSeen time.Time
}

type Manager struct {
	store  *store.RedisStore
	mu     sync.RWMutex
	runners map[string]*RunnerConnection
}

func NewManager(s *store.RedisStore) *Manager {
	return &Manager{
		store:   s,
		runners: make(map[string]*RunnerConnection),
	}
}

func (m *Manager) Register(ctx context.Context, runnerID, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	m.runners[runnerID] = &RunnerConnection{
		ID:       runnerID,
		UserID:   userID,
		Stream:   make(chan interface{}, 100),
		LastSeen: time.Now(),
	}
	
	return m.store.AddUserRunner(ctx, userID, runnerID)
}

func (m *Manager) GetRunner(runnerID string) (*RunnerConnection, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	conn, ok := m.runners[runnerID]
	return conn, ok
}

func (m *Manager) GetRunnersByUser(userID string) []*RunnerConnection {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	var runners []*RunnerConnection
	for _, conn := range m.runners {
		if conn.UserID == userID {
			runners = append(runners, conn)
		}
	}
	return runners
}

func (m *Manager) UpdateHeartbeat(runnerID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	
	if conn, ok := m.runners[runnerID]; ok {
		conn.LastSeen = time.Now()
	}
}

func (m *Manager) SendCommand(runnerID string, cmd interface{}) error {
	m.mu.RLock()
	defer m.mu.RUnlock()
	
	if conn, ok := m.runners[runnerID]; ok {
		select {
		case conn.Stream <- cmd:
			return nil
		default:
			return ErrStreamFull
		}
	}
	return ErrRunnerNotFound
}

var (
	ErrRunnerNotFound = errors.New("runner not found")
	ErrStreamFull     = errors.New("runner stream full")
)
```

- [ ] **Step 2: 实现 gRPC Server**

```go
package server

import (
	"context"
	"log/slog"
	"net"
	
	"google.golang.org/grpc"
	
	pb "github.com/chaitin/MonkeyCode/taskflow/pkg/proto"
	"github.com/chaitin/MonkeyCode/taskflow/internal/runner"
	"github.com/chaitin/MonkeyCode/taskflow/internal/store"
)

type GRPCServer struct {
	pb.UnimplementedRunnerServiceServer
	store   *store.RedisStore
	manager *runner.Manager
	logger  *slog.Logger
}

func NewGRPCServer(s *store.RedisStore, m *runner.Manager, logger *slog.Logger) *GRPCServer {
	return &GRPCServer{
		store:   s,
		manager: m,
		logger:  logger,
	}
}

func (s *GRPCServer) Register(ctx context.Context, req *pb.RegisterRequest) (*pb.RegisterResponse, error) {
	s.logger.Info("runner registering", "hostname", req.Hostname, "ip", req.Ip)
	
	runnerID := generateRunnerID()
	
	runner := &store.Runner{
		ID:       runnerID,
		Hostname: req.Hostname,
		IP:       req.Ip,
		Status:   "online",
		LastSeen: time.Now().Unix(),
		Capacity: map[string]int64{
			"cores":  int64(req.Cores),
			"memory": req.Memory,
			"disk":   req.Disk,
		},
	}
	
	if err := s.store.RegisterRunner(ctx, runner, 60*time.Second); err != nil {
		return nil, err
	}
	
	return &pb.RegisterResponse{
		RunnerId: runnerID,
		Success:  true,
		Message:  "registered successfully",
	}, nil
}

func (s *GRPCServer) Heartbeat(ctx context.Context, req *pb.HeartbeatRequest) (*pb.HeartbeatResponse, error) {
	s.manager.UpdateHeartbeat(req.RunnerId)
	
	runner := &store.Runner{
		ID:       req.RunnerId,
		LastSeen: req.Timestamp,
	}
	
	if err := s.store.RegisterRunner(ctx, runner, 60*time.Second); err != nil {
		return nil, err
	}
	
	return &pb.HeartbeatResponse{Success: true}, nil
}

func (s *GRPCServer) CreateVM(ctx context.Context, req *pb.CreateVMRequest) (*pb.CreateVMResponse, error) {
	conn, ok := s.manager.GetRunner(req.RunnerId)
	if !ok {
		return nil, runner.ErrRunnerNotFound
	}
	
	vmID := generateVMID()
	
	vm := &store.VM{
		ID:          vmID,
		RunnerID:    req.RunnerId,
		UserID:      req.UserId,
		Status:      "pending",
		CreatedAt:   time.Now().Unix(),
	}
	
	if err := s.store.SetVM(ctx, vm); err != nil {
		return nil, err
	}
	
	if err := s.store.AddUserVM(ctx, req.UserId, vmID); err != nil {
		return nil, err
	}
	
	return &pb.CreateVMResponse{
		VmId:   vmID,
		Success: true,
	}, nil
}

func StartGRPCServer(addr string, srv *GRPCServer) error {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	
	grpcServer := grpc.NewServer()
	pb.RegisterRunnerServiceServer(grpcServer, srv)
	
	return grpcServer.Serve(lis)
}
```

- [ ] **Step 3: 提交代码**

```bash
git add taskflow/internal/server/ taskflow/internal/runner/
git commit -m "feat(taskflow): add gRPC server implementation"
```

---

### Task 1.6: 实现 HTTP Server

**Files:**
- Create: `taskflow/internal/server/http.go`
- Create: `taskflow/internal/handler/host.go`
- Create: `taskflow/internal/handler/vm.go`
- Create: `taskflow/internal/handler/stats.go`

- [ ] **Step 1: 实现 HTTP Server 框架**

```go
package server

import (
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	
	"github.com/chaitin/MonkeyCode/taskflow/internal/handler"
)

func NewHTTPServer() *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORS())
	
	return e
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
	
	internal.GET("/stats", h.Stats.Get)
}
```

- [ ] **Step 2: 实现 Host Handler**

```go
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
		return err
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
		return err
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
```

- [ ] **Step 3: 实现 VM Handler**

```go
package handler

import (
	"net/http"
	"time"
	
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	
	"github.com/chaitin/MonkeyCode/taskflow/internal/store"
	"github.com/chaitin/MonkeyCode/taskflow/internal/runner"
)

type VMHandler struct {
	store   *store.RedisStore
	manager *runner.Manager
}

func NewVMHandler(s *store.RedisStore, m *runner.Manager) *VMHandler {
	return &VMHandler{store: s, manager: m}
}

type CreateVMRequest struct {
	HostID    string            `json:"host_id"`
	UserID    string            `json:"user_id"`
	ImageURL  string            `json:"image_url"`
	GitURL    string            `json:"git_url"`
	GitToken  string            `json:"git_token"`
	Cores     int32             `json:"cores"`
	Memory    int64             `json:"memory"`
	EnvVars   map[string]string `json:"env_vars"`
	TTL       int64             `json:"ttl_seconds"`
}

func (h *VMHandler) Create(c echo.Context) error {
	var req CreateVMRequest
	if err := c.Bind(&req); err != nil {
		return err
	}
	
	vmID := uuid.New().String()
	
	vm := &store.VM{
		ID:        vmID,
		RunnerID:  req.HostID,
		UserID:    req.UserID,
		Status:    "pending",
		CreatedAt: time.Now().Unix(),
	}
	
	if err := h.store.SetVM(c.Request().Context(), vm); err != nil {
		return err
	}
	
	if err := h.store.AddUserVM(c.Request().Context(), req.UserID, vmID); err != nil {
		return err
	}
	
	return c.JSON(http.StatusOK, map[string]interface{}{
		"code": 0,
		"data": vm,
	})
}

func (h *VMHandler) Delete(c echo.Context) error {
	vmID := c.QueryParam("id")
	userID := c.QueryParam("user_id")
	hostID := c.QueryParam("host_id")
	
	vm, err := h.store.GetVM(c.Request().Context(), vmID)
	if err != nil {
		return err
	}
	
	vm.Status = "deleted"
	if err := h.store.SetVM(c.Request().Context(), vm); err != nil {
		return err
	}
	
	return c.JSON(http.StatusOK, map[string]interface{}{
		"code":    0,
		"message": "vm deleted",
	})
}

func (h *VMHandler) List(c echo.Context) error {
	userID := c.QueryParam("user_id")
	
	vmIDs, err := h.store.GetUserVMs(c.Request().Context(), userID)
	if err != nil {
		return err
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
	
	vm, err := h.store.GetVM(c.Request().Context(), vmID)
	if err != nil {
		return err
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
		return err
	}
	
	onlineMap := make(map[string]bool)
	for _, id := range req.IDs {
		vm, err := h.store.GetVM(c.Request().Context(), id)
		onlineMap[id] = err == nil && vm.Status == "online"
	}
	
	return c.JSON(http.StatusOK, map[string]interface{}{
		"code": 0,
		"data": map[string]interface{}{
			"online_map": onlineMap,
		},
	})
}
```

- [ ] **Step 4: 实现 Stats Handler**

```go
package handler

import (
	"net/http"
	
	"github.com/labstack/echo/v4"
	
	"github.com/chaitin/MonkeyCode/taskflow/internal/store"
	"github.com/chaitin/MonkeyCode/taskflow/internal/runner"
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
```

- [ ] **Step 5: 添加依赖并提交**

```bash
cd taskflow && go get github.com/labstack/echo/v4 github.com/google/uuid
git add taskflow/internal/server/ taskflow/internal/handler/
git commit -m "feat(taskflow): add HTTP server and handlers"
```

---

### Task 1.7: 创建 Runner 项目结构

**Files:**
- Create: `runner/go.mod`
- Create: `runner/Makefile`
- Create: `runner/config.yaml`
- Create: `runner/cmd/runner/main.go`
- Create: `runner/internal/config/config.go`
- Create: `runner/internal/client/grpc.go`

- [ ] **Step 1: 创建 Runner 项目目录**

```bash
mkdir -p runner/{cmd/runner,internal/{config,client,docker,terminal,agent,file,portforward},scripts}
cd runner
go mod init github.com/chaitin/MonkeyCode/runner
```

- [ ] **Step 2: 创建 Runner 配置**

```go
package config

type Config struct {
	Token    string `yaml:"token" env:"TOKEN"`
	GRPCAddr string `yaml:"grpc_addr" env:"GRPC_URL"`
	GRPCPort int    `yaml:"grpc_port" env:"GRPC_PORT"`
}

func Load() *Config {
	return &Config{
		Token:    os.Getenv("TOKEN"),
		GRPCAddr: os.Getenv("GRPC_URL"),
		GRPCPort: getEnvInt("GRPC_PORT", 50051),
	}
}
```

- [ ] **Step 3: 实现 gRPC Client**

```go
package client

import (
	"context"
	"log/slog"
	
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	
	pb "github.com/chaitin/MonkeyCode/taskflow/pkg/proto"
)

type Client struct {
	conn   *grpc.ClientConn
	client pb.RunnerServiceClient
	logger *slog.Logger
}

func New(addr string, logger *slog.Logger) (*Client, error) {
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, err
	}
	
	return &Client{
		conn:   conn,
		client: pb.NewRunnerServiceClient(conn),
		logger: logger,
	}, nil
}

func (c *Client) Close() error {
	return c.conn.Close()
}

func (c *Client) Register(ctx context.Context, token, hostname, ip string, cores int32, memory, disk int64) (string, error) {
	resp, err := c.client.Register(ctx, &pb.RegisterRequest{
		Token:    token,
		Hostname: hostname,
		Ip:       ip,
		Cores:    cores,
		Memory:   memory,
		Disk:     disk,
	})
	if err != nil {
		return "", err
	}
	return resp.RunnerId, nil
}

func (c *Client) Heartbeat(ctx context.Context, runnerID string, runningVMs, runningTasks int32) error {
	_, err := c.client.Heartbeat(ctx, &pb.HeartbeatRequest{
		RunnerId:     runnerID,
		Timestamp:    time.Now().Unix(),
		RunningVms:   runningVMs,
		RunningTasks: runningTasks,
	})
	return err
}
```

- [ ] **Step 4: 创建 Runner 入口**

```go
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
	
	"github.com/chaitin/MonkeyCode/runner/internal/client"
	"github.com/chaitin/MonkeyCode/runner/internal/config"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	
	cfg := config.Load()
	if cfg.Token == "" {
		logger.Error("TOKEN environment variable is required")
		os.Exit(1)
	}
	
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	
	client, err := client.New(cfg.GRPCAddr, logger)
	if err != nil {
		logger.Error("failed to connect to taskflow", "error", err)
		os.Exit(1)
	}
	defer client.Close()
	
	hostname, _ := os.Hostname()
	ip := getLocalIP()
	
	runnerID, err := client.Register(ctx, cfg.Token, hostname, ip, 8, 16384, 100000)
	if err != nil {
		logger.Error("failed to register", "error", err)
		os.Exit(1)
	}
	
	logger.Info("runner registered", "runner_id", runnerID)
	
	go startHeartbeat(ctx, client, runnerID, logger)
	
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	
	logger.Info("shutting down runner")
}

func startHeartbeat(ctx context.Context, client *client.Client, runnerID string, logger *slog.Logger) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := client.Heartbeat(ctx, runnerID, 0, 0); err != nil {
				logger.Error("heartbeat failed", "error", err)
			}
		}
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
```

- [ ] **Step 5: 提交代码**

```bash
git add runner/
git commit -m "feat(runner): initialize runner project with gRPC client"
```

---

## 阶段 1 完成检查点

- [ ] TaskFlow 项目结构已创建
- [ ] TaskFlow 配置管理已实现
- [ ] TaskFlow Redis 存储已实现
- [ ] TaskFlow gRPC 协议已定义
- [ ] TaskFlow gRPC Server 已实现
- [ ] TaskFlow HTTP Server 已实现
- [ ] Runner 项目结构已创建
- [ ] Runner gRPC Client 已实现
- [ ] Runner 能成功注册到 TaskFlow
- [ ] Runner 心跳机制正常工作

**验收标准:** Runner 能成功注册到 TaskFlow，心跳正常，基础 API 可用。

---

## 阶段 2-5 任务概要

由于篇幅限制，后续阶段的详细任务将在下一份计划文档中展开：

### 阶段 2: 宿主机和虚拟机管理 (Week 3-4)
- Task 2.1: 实现 Docker Manager
- Task 2.2: 实现容器创建/删除
- Task 2.3: 实现 PTY 终端
- Task 2.4: 实现 WebSocket 终端代理
- Task 2.5: 集成测试

### 阶段 3: 任务管理 (Week 5-6)
- Task 3.1: 实现 Task API
- Task 3.2: 集成 OpenCode Agent
- Task 3.3: 实现任务执行引擎
- Task 3.4: 实现进度上报
- Task 3.5: 集成测试

### 阶段 4: 文件管理和端口转发 (Week 7)
- Task 4.1: 实现文件上传/下载
- Task 4.2: 实现文件操作 API
- Task 4.3: 实现端口转发
- Task 4.4: 集成测试

### 阶段 5: 集成和测试 (Week 8)
- Task 5.1: MonkeyCode 后端集成
- Task 5.2: 端到端测试
- Task 5.3: 性能优化
- Task 5.4: 文档编写
- Task 5.5: 部署脚本

---

## 参考文档

- 设计文档: `docs/superpowers/specs/2026-03-22-taskflow-runner-design.md`
- MonkeyCode 后端: `backend/pkg/taskflow/`
- Docker SDK: https://docs.docker.com/engine/api/sdk/
- gRPC Go: https://grpc.io/docs/languages/go/
