package lifecycle

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	taskrepo "github.com/chaitin/MonkeyCode/backend/biz/task/repo"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestTaskHook_OnStateChange_FinishedUpdatesTaskStatusAndCompletedAt(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:task-hook-finished-test?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	repo := &taskHookRepoStub{
		taskRepo: &taskrepo.TaskRepo{},
		client:   client,
	}

	userID := uuid.New()
	if _, err := client.User.Create().
		SetID(userID).
		SetName("tester").
		SetRole(consts.UserRoleIndividual).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatalf("create user: %v", err)
	}

	taskID := uuid.New()
	if _, err := client.Task.Create().
		SetID(taskID).
		SetUserID(userID).
		SetKind(consts.TaskTypeDevelop).
		SetContent("demo").
		SetStatus(consts.TaskStatusProcessing).
		Save(ctx); err != nil {
		t.Fatalf("create task: %v", err)
	}

	hook := &TaskHook{
		repo:   repo,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	if err := hook.OnStateChange(ctx, taskID, consts.TaskStatusProcessing, consts.TaskStatusFinished, TaskMetadata{
		TaskID: taskID,
		UserID: userID,
	}); err != nil {
		t.Fatalf("OnStateChange() error = %v", err)
	}

	got, err := client.Task.Get(ctx, taskID)
	if err != nil {
		t.Fatalf("query task: %v", err)
	}
	if got.Status != consts.TaskStatusFinished {
		t.Fatalf("task status = %s, want %s", got.Status, consts.TaskStatusFinished)
	}
	if got.CompletedAt.IsZero() {
		t.Fatal("expected completed_at to be set")
	}
	if time.Since(got.CompletedAt) > time.Minute {
		t.Fatalf("completed_at = %v, looks stale", got.CompletedAt)
	}
}

type taskHookRepoStub struct {
	taskRepo *taskrepo.TaskRepo
	client   *db.Client
}

func (s *taskHookRepoStub) GetByID(ctx context.Context, id uuid.UUID) (*db.Task, error) {
	return s.client.Task.Get(ctx, id)
}

func (s *taskHookRepoStub) Stat(context.Context, uuid.UUID) (*domain.TaskStats, error) {
	panic("unexpected call to Stat")
}

func (s *taskHookRepoStub) StatByIDs(context.Context, []uuid.UUID) (map[uuid.UUID]*domain.TaskStats, error) {
	panic("unexpected call to StatByIDs")
}

func (s *taskHookRepoStub) Info(context.Context, *domain.User, uuid.UUID, bool) (*db.Task, error) {
	panic("unexpected call to Info")
}

func (s *taskHookRepoStub) List(context.Context, *domain.User, domain.TaskListReq) ([]*db.ProjectTask, *db.PageInfo, error) {
	panic("unexpected call to List")
}

func (s *taskHookRepoStub) Create(context.Context, *domain.User, domain.CreateTaskReq, string, func(*db.ProjectTask, *db.Model, *db.Image) (*taskflow.VirtualMachine, error)) (*db.ProjectTask, error) {
	panic("unexpected call to Create")
}

func (s *taskHookRepoStub) Update(ctx context.Context, _ *domain.User, id uuid.UUID, fn func(up *db.TaskUpdateOne) error) error {
	up := s.client.Task.UpdateOneID(id)
	if err := fn(up); err != nil {
		return err
	}
	return up.Exec(ctx)
}

func (s *taskHookRepoStub) RefreshLastActiveAt(context.Context, uuid.UUID, time.Time, time.Duration) error {
	panic("unexpected call to RefreshLastActiveAt")
}

func (s *taskHookRepoStub) Stop(context.Context, *domain.User, uuid.UUID, func(*db.Task) error) error {
	panic("unexpected call to Stop")
}

func (s *taskHookRepoStub) Delete(context.Context, *domain.User, uuid.UUID) error {
	panic("unexpected call to Delete")
}
