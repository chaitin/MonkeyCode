package usecase

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/domain"
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

func (s *hostTaskRepoStub) UpdateProjectTaskModel(context.Context, uuid.UUID, uuid.UUID) error {
	panic("unexpected call to UpdateProjectTaskModel")
}

func (s *hostTaskRepoStub) CreateModelSwitch(context.Context, *domain.TaskModelSwitch) error {
	panic("unexpected call to CreateModelSwitch")
}

func (s *hostTaskRepoStub) FinishModelSwitch(context.Context, uuid.UUID, bool, string, string) error {
	panic("unexpected call to FinishModelSwitch")
}

func (s *hostTaskRepoStub) CompleteModelSwitch(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, bool, string, string) error {
	panic("unexpected call to CompleteModelSwitch")
}
