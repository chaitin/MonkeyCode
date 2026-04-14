package v1

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/GoYoko/web"
	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/lifecycle"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestVmReady_TransitionsPRReviewTaskToProcessing(t *testing.T) {
	taskID := uuid.New()
	userID := uuid.New()
	vmID := "vm-1"
	mr := miniredis.RunT(t)

	h := &InternalHostHandler{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		repo: &stubHostRepo{
			vm: &db.VirtualMachine{
				ID: vmID,
				Edges: db.VirtualMachineEdges{
					Tasks: []*db.Task{
						{
							ID:      taskID,
							UserID:  userID,
							Status:  consts.TaskStatusPending,
							Kind:    consts.TaskTypeReview,
							SubType: consts.TaskSubTypePrReview,
						},
					},
				},
			},
		},
		taskLifecycle: lifecycle.NewManager[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata](
			redis.NewClient(&redis.Options{Addr: mr.Addr()}),
			lifecycle.WithTransitions[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata](lifecycle.TaskTransitions()),
		),
	}

	if err := h.taskLifecycle.Transition(context.Background(), taskID, consts.TaskStatusPending, lifecycle.TaskMetadata{
		TaskID: taskID,
		UserID: userID,
	}); err != nil {
		t.Fatalf("seed pending state: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/internal/vm-ready", nil)
	rec := httptest.NewRecorder()

	if err := h.VmReady(newHostTestWebContext(req, rec), taskflow.VirtualMachine{ID: vmID}); err != nil {
		t.Fatalf("VmReady returned error: %v", err)
	}

	state, err := h.taskLifecycle.GetState(context.Background(), taskID)
	if err != nil {
		t.Fatalf("GetState returned error: %v", err)
	}
	if state != consts.TaskStatusProcessing {
		t.Fatalf("expected task state %q, got %q", consts.TaskStatusProcessing, state)
	}
}

func newHostTestWebContext(req *http.Request, rec *httptest.ResponseRecorder) *web.Context {
	e := echo.New()
	e.Validator = web.NewCustomValidator()
	return &web.Context{Context: e.NewContext(req, rec)}
}

type stubHostRepo struct {
	vm *db.VirtualMachine
}

func (s *stubHostRepo) List(context.Context, uuid.UUID) ([]*db.Host, error) {
	panic("unexpected List call")
}

func (s *stubHostRepo) GetHost(context.Context, uuid.UUID, string) (*domain.Host, error) {
	panic("unexpected GetHost call")
}

func (s *stubHostRepo) GetByID(context.Context, string) (*db.Host, error) {
	panic("unexpected GetByID call")
}

func (s *stubHostRepo) GetVirtualMachine(context.Context, string) (*db.VirtualMachine, error) {
	return s.vm, nil
}

func (s *stubHostRepo) GetVirtualMachineByEnvID(context.Context, string) (*db.VirtualMachine, error) {
	panic("unexpected GetVirtualMachineByEnvID call")
}

func (s *stubHostRepo) GetVirtualMachineWithUser(context.Context, uuid.UUID, string) (*db.VirtualMachine, error) {
	panic("unexpected GetVirtualMachineWithUser call")
}

func (s *stubHostRepo) CreateVirtualMachine(context.Context, *domain.User, *domain.CreateVMReq, func(context.Context) (string, error), func(*db.Model, *db.Image) (*domain.VirtualMachine, error)) (*domain.VirtualMachine, error) {
	panic("unexpected CreateVirtualMachine call")
}

func (s *stubHostRepo) PastHourVirtualMachine(context.Context) ([]*db.VirtualMachine, error) {
	panic("unexpected PastHourVirtualMachine call")
}

func (s *stubHostRepo) AllCountDownVirtualMachine(context.Context) ([]*db.VirtualMachine, error) {
	panic("unexpected AllCountDownVirtualMachine call")
}

func (s *stubHostRepo) DeleteVirtualMachine(context.Context, uuid.UUID, string, string, func(*db.VirtualMachine) error) error {
	panic("unexpected DeleteVirtualMachine call")
}

func (s *stubHostRepo) UpsertVirtualMachine(context.Context, *taskflow.VirtualMachine) error {
	panic("unexpected UpsertVirtualMachine call")
}

func (s *stubHostRepo) UpdateVirtualMachine(context.Context, string, func(*db.VirtualMachineUpdateOne) error) error {
	panic("unexpected UpdateVirtualMachine call")
}

func (s *stubHostRepo) UpsertHost(context.Context, *taskflow.Host) error {
	panic("unexpected UpsertHost call")
}

func (s *stubHostRepo) DeleteHost(context.Context, uuid.UUID, string) error {
	panic("unexpected DeleteHost call")
}

func (s *stubHostRepo) UpdateHost(context.Context, uuid.UUID, *domain.UpdateHostReq) error {
	panic("unexpected UpdateHost call")
}

func (s *stubHostRepo) UpdateVM(context.Context, domain.UpdateVMReq, func(*db.VirtualMachine) error) (*db.VirtualMachine, int64, error) {
	panic("unexpected UpdateVM call")
}

func (s *stubHostRepo) GetGitCredentialByTask(context.Context, string) (*domain.GitCredentialInfo, error) {
	panic("unexpected GetGitCredentialByTask call")
}

var _ domain.HostRepo = (*stubHostRepo)(nil)
