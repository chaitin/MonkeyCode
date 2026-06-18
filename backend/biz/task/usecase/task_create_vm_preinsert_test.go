package usecase

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	taskrepo "github.com/chaitin/MonkeyCode/backend/biz/task/repo"
	vmidle "github.com/chaitin/MonkeyCode/backend/biz/vmidle/usecase"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/db/taskvirtualmachine"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/lifecycle"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestTaskUsecaseCreatePreinsertsVirtualMachineBeforeTaskflowCreate(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:task-usecase-create-vm-preinsert-test?mode=memory&cache=shared&_fk=1")
	t.Cleanup(func() { _ = client.Close() })

	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	userID := uuid.New()
	modelID := uuid.New()
	imageID := uuid.New()
	hostID := "host-task-usecase-preinsert"
	if _, err := client.User.Create().SetID(userID).SetName("user").SetRole(consts.UserRoleIndividual).SetStatus(consts.UserStatusActive).Save(ctx); err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := client.Host.Create().SetID(hostID).SetUserID(userID).Save(ctx); err != nil {
		t.Fatalf("create host: %v", err)
	}
	if _, err := client.Model.Create().SetID(modelID).SetUserID(userID).SetProvider("OpenAI").SetAPIKey("secret").SetBaseURL("https://api.example.com").SetModel("gpt-4o").Save(ctx); err != nil {
		t.Fatalf("create model: %v", err)
	}
	if _, err := client.Image.Create().SetID(imageID).SetUserID(userID).SetName("image").Save(ctx); err != nil {
		t.Fatalf("create image: %v", err)
	}

	vmCreate := &taskPreinsertVMCreateStub{db: client}
	cfg := &config.Config{}
	cfg.LLMProxy.BaseURL = "https://llm-proxy.example.com"
	i := do.New()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	do.ProvideValue(i, cfg)
	do.ProvideValue(i, client)
	do.ProvideValue(i, logger)
	taskRepo, err := taskrepo.NewTaskRepo(i)
	if err != nil {
		t.Fatalf("new task repo: %v", err)
	}
	uc := &TaskUsecase{
		cfg:                   cfg,
		repo:                  taskRepo,
		logger:                logger,
		taskflow:              &taskPreinsertTaskflowStub{vm: vmCreate},
		redis:                 rdb,
		taskLifecycle:         lifecycle.NewManager[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata](rdb, lifecycle.WithTransitions[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata](lifecycle.TaskTransitions())),
		vmLifecycle:           lifecycle.NewManager[string, lifecycle.VMState, lifecycle.VMMetadata](rdb, lifecycle.WithTransitions[string, lifecycle.VMState, lifecycle.VMMetadata](lifecycle.VMTransitions())),
		taskActivityRefresher: noopTaskActivityRefresher{},
		idleRefresher:         noopVMIdleRefresher{},
		dbClient:              client,
	}

	_, err = uc.Create(ctx, &domain.User{ID: userID}, domain.CreateTaskReq{
		Content: "content",
		HostID:  hostID,
		ImageID: imageID,
		ModelID: modelID.String(),
		CliName: consts.CliNameCodex,
		Resource: &domain.VMResource{
			Core:   1,
			Memory: 1024,
		},
		Type: consts.TaskTypeDevelop,
		RepoReq: domain.TaskRepoReq{
			RepoURL: "https://example.com/repo.git",
			Branch:  "main",
		},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if vmCreate.seenID == "" {
		t.Fatal("expected taskflow create to receive preallocated vm id")
	}
}

type taskPreinsertTaskflowStub struct {
	vm taskflow.VirtualMachiner
}

func (s *taskPreinsertTaskflowStub) VirtualMachiner() taskflow.VirtualMachiner { return s.vm }
func (s *taskPreinsertTaskflowStub) Host() taskflow.Hoster                     { return taskPreinsertHosterStub{} }
func (s *taskPreinsertTaskflowStub) FileManager() taskflow.FileManager         { return nil }
func (s *taskPreinsertTaskflowStub) TaskManager() taskflow.TaskManager         { return nil }
func (s *taskPreinsertTaskflowStub) PortForwarder() taskflow.PortForwarder     { return nil }
func (s *taskPreinsertTaskflowStub) Stats(context.Context) (*taskflow.Stats, error) {
	return nil, nil
}
func (s *taskPreinsertTaskflowStub) TaskLive(context.Context, string, bool, func(*taskflow.TaskChunk) error) error {
	return nil
}

type taskPreinsertHosterStub struct{}

func (taskPreinsertHosterStub) List(context.Context, string) (map[string]*taskflow.Host, error) {
	return nil, nil
}
func (taskPreinsertHosterStub) IsOnline(_ context.Context, req *taskflow.IsOnlineReq[string]) (*taskflow.IsOnlineResp, error) {
	online := make(map[string]bool, len(req.IDs))
	for _, id := range req.IDs {
		online[id] = true
	}
	return &taskflow.IsOnlineResp{OnlineMap: online}, nil
}

type taskPreinsertVMCreateStub struct {
	db     *db.Client
	seenID string
}

func (s *taskPreinsertVMCreateStub) Create(ctx context.Context, req *taskflow.CreateVirtualMachineReq) (*taskflow.VirtualMachine, error) {
	if req.ID == "" {
		return nil, fmt.Errorf("taskflow create req id is empty")
	}
	if _, err := s.db.VirtualMachine.Get(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("virtual machine %s not visible before taskflow create: %w", req.ID, err)
	}
	if _, err := s.db.TaskVirtualMachine.Query().
		Where(taskvirtualmachine.VirtualmachineIDEQ(req.ID), taskvirtualmachine.TaskID(req.TaskID)).
		Only(ctx); err != nil {
		return nil, fmt.Errorf("task vm relation not visible before taskflow create: %w", err)
	}
	s.seenID = req.ID
	return &taskflow.VirtualMachine{
		ID:            req.ID,
		AccessToken:   "access-" + req.ID,
		EnvironmentID: "env-" + req.ID,
		HostID:        req.HostID,
	}, nil
}
func (s *taskPreinsertVMCreateStub) Delete(context.Context, *taskflow.DeleteVirtualMachineReq) error {
	return nil
}
func (s *taskPreinsertVMCreateStub) Hibernate(context.Context, *taskflow.HibernateVirtualMachineReq) error {
	return nil
}
func (s *taskPreinsertVMCreateStub) Resume(context.Context, *taskflow.ResumeVirtualMachineReq) error {
	return nil
}
func (s *taskPreinsertVMCreateStub) List(context.Context, string) ([]*taskflow.VirtualMachine, error) {
	return nil, nil
}
func (s *taskPreinsertVMCreateStub) Info(context.Context, taskflow.VirtualMachineInfoReq) (*taskflow.VirtualMachine, error) {
	return nil, nil
}
func (s *taskPreinsertVMCreateStub) Terminal(context.Context, *taskflow.TerminalReq) (taskflow.Sheller, error) {
	return nil, nil
}
func (s *taskPreinsertVMCreateStub) Reports(context.Context, taskflow.ReportSubscribeReq) (taskflow.Reporter, error) {
	return nil, nil
}
func (s *taskPreinsertVMCreateStub) TerminalList(context.Context, string) ([]*taskflow.Terminal, error) {
	return nil, nil
}
func (s *taskPreinsertVMCreateStub) CloseTerminal(context.Context, *taskflow.CloseTerminalReq) error {
	return nil
}
func (s *taskPreinsertVMCreateStub) IsOnline(context.Context, *taskflow.IsOnlineReq[string]) (*taskflow.IsOnlineResp, error) {
	return nil, nil
}

type noopTaskActivityRefresher struct{}

func (noopTaskActivityRefresher) Refresh(context.Context, uuid.UUID) error      { return nil }
func (noopTaskActivityRefresher) ForceRefresh(context.Context, uuid.UUID) error { return nil }

type noopVMIdleRefresher struct{}

func (noopVMIdleRefresher) Refresh(context.Context, string) error { return nil }

var _ vmidle.VMIdleRefresher = noopVMIdleRefresher{}
