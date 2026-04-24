package usecase

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestHostUsecase_markRecycledTasksFinished(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:host-usecase-task-finish-test?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	userID := uuid.New()
	if _, err := client.User.Create().
		SetID(userID).
		SetName("tester").
		SetRole(consts.UserRoleIndividual).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatalf("create user: %v", err)
	}

	createTask := func(status consts.TaskStatus) *db.Task {
		taskID := uuid.New()
		tk, err := client.Task.Create().
			SetID(taskID).
			SetUserID(userID).
			SetKind(consts.TaskTypeDevelop).
			SetContent(string(status)).
			SetStatus(status).
			Save(ctx)
		if err != nil {
			t.Fatalf("create task(%s): %v", status, err)
		}
		return tk
	}

	processingTask := createTask(consts.TaskStatusProcessing)
	finishedTask := createTask(consts.TaskStatusFinished)
	errorTask := createTask(consts.TaskStatusError)

	taskRepo := &hostTaskRepoStub{client: client}
	u := &HostUsecase{
		taskRepo: taskRepo,
		logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	vm := &db.VirtualMachine{
		ID: "vm-1",
		Edges: db.VirtualMachineEdges{
			Tasks: []*db.Task{
				processingTask,
				finishedTask,
				errorTask,
				nil,
			},
		},
	}

	if err := u.markRecycledTasksFinished(ctx, vm); err != nil {
		t.Fatalf("markRecycledTasksFinished() error = %v", err)
	}

	gotProcessing, err := client.Task.Get(ctx, processingTask.ID)
	if err != nil {
		t.Fatalf("query processing task: %v", err)
	}
	if gotProcessing.Status != consts.TaskStatusFinished {
		t.Fatalf("processing task status = %s, want %s", gotProcessing.Status, consts.TaskStatusFinished)
	}
	if gotProcessing.CompletedAt.IsZero() {
		t.Fatal("expected processing task completed_at to be set")
	}

	gotFinished, err := client.Task.Get(ctx, finishedTask.ID)
	if err != nil {
		t.Fatalf("query finished task: %v", err)
	}
	if !gotFinished.CompletedAt.IsZero() {
		t.Fatal("expected already finished task completed_at to remain unchanged")
	}

	gotError, err := client.Task.Get(ctx, errorTask.ID)
	if err != nil {
		t.Fatalf("query error task: %v", err)
	}
	if gotError.Status != consts.TaskStatusError {
		t.Fatalf("error task status = %s, want %s", gotError.Status, consts.TaskStatusError)
	}

	if len(taskRepo.updatedIDs) != 1 || taskRepo.updatedIDs[0] != processingTask.ID {
		t.Fatalf("updated task ids = %v, want only %s", taskRepo.updatedIDs, processingTask.ID)
	}
}

func TestHostUsecase_DeleteVMMarksLinkedTasksFinished(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	taskID := uuid.New()
	vm := &db.VirtualMachine{
		ID:            "vm-delete",
		HostID:        "host-delete",
		EnvironmentID: "env-delete",
		UserID:        userID,
		Edges: db.VirtualMachineEdges{Tasks: []*db.Task{{
			ID:     taskID,
			UserID: userID,
			Status: consts.TaskStatusProcessing,
		}}},
	}
	taskRepo := &hostTaskRepoStub{}
	repo := &hostRepoDeleteStub{vm: vm}
	rdb := newHostTestRedis(t)
	u := &HostUsecase{
		repo:             repo,
		taskRepo:         taskRepo,
		taskflow:         &hostTaskflowStub{vm: &hostVMDeleterStub{}},
		vmexpireQueue:    delayqueue.NewVMExpireQueue(rdb, slog.New(slog.NewTextHandler(io.Discard, nil))),
		logger:           slog.New(slog.NewTextHandler(io.Discard, nil)),
		privilegeChecker: nil,
	}

	if err := u.DeleteVM(ctx, userID, vm.HostID, vm.ID); err != nil {
		t.Fatalf("DeleteVM() error = %v", err)
	}

	if !repo.deleted {
		t.Fatal("expected vm to be deleted")
	}
	if len(taskRepo.updatedIDs) != 1 || taskRepo.updatedIDs[0] != taskID {
		t.Fatalf("updated task ids = %v, want %s", taskRepo.updatedIDs, taskID)
	}
}

type hostTaskRepoStub struct {
	client     *db.Client
	updatedIDs []uuid.UUID
}

func (s *hostTaskRepoStub) GetByID(ctx context.Context, id uuid.UUID) (*db.Task, error) {
	return s.client.Task.Get(ctx, id)
}

func (s *hostTaskRepoStub) Stat(context.Context, uuid.UUID) (*domain.TaskStats, error) {
	panic("unexpected call to Stat")
}

func (s *hostTaskRepoStub) StatByIDs(context.Context, []uuid.UUID) (map[uuid.UUID]*domain.TaskStats, error) {
	panic("unexpected call to StatByIDs")
}

func (s *hostTaskRepoStub) Info(context.Context, *domain.User, uuid.UUID, bool) (*db.Task, error) {
	panic("unexpected call to Info")
}

func (s *hostTaskRepoStub) List(context.Context, *domain.User, domain.TaskListReq) ([]*db.ProjectTask, *db.PageInfo, error) {
	panic("unexpected call to List")
}

func (s *hostTaskRepoStub) Create(context.Context, *domain.User, domain.CreateTaskReq, string, func(*db.ProjectTask, *db.Model, *db.Image) (*taskflow.VirtualMachine, error)) (*db.ProjectTask, error) {
	panic("unexpected call to Create")
}

func (s *hostTaskRepoStub) Update(ctx context.Context, _ *domain.User, id uuid.UUID, fn func(up *db.TaskUpdateOne) error) error {
	s.updatedIDs = append(s.updatedIDs, id)
	if s.client == nil {
		return nil
	}
	up := s.client.Task.UpdateOneID(id)
	if err := fn(up); err != nil {
		return err
	}
	return up.Exec(ctx)
}

func (s *hostTaskRepoStub) RefreshLastActiveAt(context.Context, uuid.UUID, time.Time, time.Duration) error {
	panic("unexpected call to RefreshLastActiveAt")
}

func (s *hostTaskRepoStub) Stop(context.Context, *domain.User, uuid.UUID, func(*db.Task) error) error {
	panic("unexpected call to Stop")
}

func (s *hostTaskRepoStub) Delete(context.Context, *domain.User, uuid.UUID) error {
	panic("unexpected call to Delete")
}

type hostRepoDeleteStub struct {
	vm      *db.VirtualMachine
	deleted bool
}

func (s *hostRepoDeleteStub) DeleteVirtualMachine(_ context.Context, _ uuid.UUID, _, _ string, fn func(*db.VirtualMachine) error) error {
	if err := fn(s.vm); err != nil {
		return err
	}
	s.deleted = true
	return nil
}

func (s *hostRepoDeleteStub) List(context.Context, uuid.UUID) ([]*db.Host, error) { return nil, nil }
func (s *hostRepoDeleteStub) GetHost(context.Context, uuid.UUID, string) (*domain.Host, error) {
	return nil, nil
}
func (s *hostRepoDeleteStub) GetByID(context.Context, string) (*db.Host, error) { return nil, nil }
func (s *hostRepoDeleteStub) GetVirtualMachine(context.Context, string) (*db.VirtualMachine, error) {
	return s.vm, nil
}
func (s *hostRepoDeleteStub) GetVirtualMachineByEnvID(context.Context, string) (*db.VirtualMachine, error) {
	return s.vm, nil
}
func (s *hostRepoDeleteStub) GetVirtualMachineWithUser(context.Context, uuid.UUID, string) (*db.VirtualMachine, error) {
	return s.vm, nil
}
func (s *hostRepoDeleteStub) CreateVirtualMachine(context.Context, *domain.User, *domain.CreateVMReq, func(context.Context) (string, error), func(*db.Model, *db.Image) (*domain.VirtualMachine, error)) (*domain.VirtualMachine, error) {
	return nil, nil
}
func (s *hostRepoDeleteStub) PastHourVirtualMachine(context.Context) ([]*db.VirtualMachine, error) {
	return nil, nil
}
func (s *hostRepoDeleteStub) AllCountDownVirtualMachine(context.Context) ([]*db.VirtualMachine, error) {
	return nil, nil
}
func (s *hostRepoDeleteStub) UpsertVirtualMachine(context.Context, *taskflow.VirtualMachine) error {
	return nil
}
func (s *hostRepoDeleteStub) UpdateVirtualMachine(context.Context, string, func(*db.VirtualMachineUpdateOne) error) error {
	return nil
}
func (s *hostRepoDeleteStub) UpsertHost(context.Context, *taskflow.Host) error    { return nil }
func (s *hostRepoDeleteStub) DeleteHost(context.Context, uuid.UUID, string) error { return nil }
func (s *hostRepoDeleteStub) UpdateHost(context.Context, uuid.UUID, *domain.UpdateHostReq) error {
	return nil
}
func (s *hostRepoDeleteStub) UpdateVM(context.Context, domain.UpdateVMReq, func(*db.VirtualMachine) error) (*db.VirtualMachine, int64, error) {
	return nil, 0, nil
}
func (s *hostRepoDeleteStub) GetGitCredentialByTask(context.Context, string) (*domain.GitCredentialInfo, error) {
	return nil, nil
}

type hostTaskflowStub struct {
	vm taskflow.VirtualMachiner
}

func (s *hostTaskflowStub) VirtualMachiner() taskflow.VirtualMachiner      { return s.vm }
func (s *hostTaskflowStub) Host() taskflow.Hoster                          { return nil }
func (s *hostTaskflowStub) FileManager() taskflow.FileManager              { return nil }
func (s *hostTaskflowStub) TaskManager() taskflow.TaskManager              { return nil }
func (s *hostTaskflowStub) PortForwarder() taskflow.PortForwarder          { return nil }
func (s *hostTaskflowStub) Stats(context.Context) (*taskflow.Stats, error) { return nil, nil }
func (s *hostTaskflowStub) TaskLive(context.Context, string, bool, func(*taskflow.TaskChunk) error) error {
	return nil
}

type hostVMDeleterStub struct{}

func (s *hostVMDeleterStub) Delete(context.Context, *taskflow.DeleteVirtualMachineReq) error {
	return nil
}
func (s *hostVMDeleterStub) Create(context.Context, *taskflow.CreateVirtualMachineReq) (*taskflow.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}
func (s *hostVMDeleterStub) Hibernate(context.Context, *taskflow.HibernateVirtualMachineReq) error {
	return errors.New("not implemented")
}
func (s *hostVMDeleterStub) Resume(context.Context, *taskflow.ResumeVirtualMachineReq) error {
	return errors.New("not implemented")
}
func (s *hostVMDeleterStub) List(context.Context, string) ([]*taskflow.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}
func (s *hostVMDeleterStub) Info(context.Context, taskflow.VirtualMachineInfoReq) (*taskflow.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}
func (s *hostVMDeleterStub) Terminal(context.Context, *taskflow.TerminalReq) (taskflow.Sheller, error) {
	return nil, errors.New("not implemented")
}
func (s *hostVMDeleterStub) Reports(context.Context, taskflow.ReportSubscribeReq) (taskflow.Reporter, error) {
	return nil, errors.New("not implemented")
}
func (s *hostVMDeleterStub) TerminalList(context.Context, string) ([]*taskflow.Terminal, error) {
	return nil, errors.New("not implemented")
}
func (s *hostVMDeleterStub) CloseTerminal(context.Context, *taskflow.CloseTerminalReq) error {
	return errors.New("not implemented")
}
func (s *hostVMDeleterStub) IsOnline(context.Context, *taskflow.IsOnlineReq[string]) (*taskflow.IsOnlineResp, error) {
	return nil, errors.New("not implemented")
}

func newHostTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return rdb
}
