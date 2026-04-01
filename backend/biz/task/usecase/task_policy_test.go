package usecase

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	gituc "github.com/chaitin/MonkeyCode/backend/biz/git/usecase"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/lifecycle"
	"github.com/chaitin/MonkeyCode/backend/pkg/loki"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/dispatcher"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestTaskPolicyPassesConcurrencyLimitToRepoCreate(t *testing.T) {
	repo := &stubTaskRepo{}
	injector := do.New()

	do.ProvideValue(injector, &config.Config{})
	do.ProvideValue(injector, domain.TaskRepo(repo))
	do.ProvideValue(injector, domain.ModelRepo((*stubModelRepo)(nil)))
	do.ProvideValue(injector, slog.New(slog.NewTextHandler(io.Discard, nil)))
	do.ProvideValue(injector, taskflow.Clienter(&stubTaskflowClient{
		hoster: &stubHoster{
			onlineMap: map[string]bool{"host-1": true},
		},
	}))
	do.ProvideValue(injector, (*loki.Client)(nil))
	do.ProvideValue(injector, (*redis.Client)(nil))
	do.ProvideValue(injector, (*dispatcher.Dispatcher)(nil))
	do.ProvideValue(injector, (*lifecycle.Manager[uuid.UUID, consts.TaskStatus, lifecycle.TaskMetadata])(nil))
	do.ProvideValue(injector, (*lifecycle.Manager[string, lifecycle.VMState, lifecycle.VMMetadata])(nil))
	do.ProvideValue(injector, domain.GitIdentityRepo((*stubGitIdentityRepo)(nil)))
	do.ProvideValue(injector, (*gituc.TokenProvider)(nil))
	do.ProvideValue(injector, domain.TaskPolicy(&stubTaskPolicy{limit: 3}))

	uc, err := NewTaskUsecase(injector)
	if err != nil {
		t.Fatalf("NewTaskUsecase() error = %v", err)
	}

	_, err = uc.Create(context.Background(), &domain.User{ID: uuid.New()}, domain.CreateTaskReq{
		HostID: "host-1",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if !repo.seenLimitOK {
		t.Fatal("expected repo.Create to receive concurrency limit in context")
	}
	if repo.seenLimit != 3 {
		t.Fatalf("repo.Create saw limit %d, want 3", repo.seenLimit)
	}
}

type stubTaskRepo struct {
	seenLimit   int
	seenLimitOK bool
}

func (s *stubTaskRepo) GetByID(context.Context, uuid.UUID) (*db.Task, error) {
	return nil, nil
}

func (s *stubTaskRepo) Stat(context.Context, uuid.UUID) (*domain.TaskStats, error) {
	return nil, nil
}

func (s *stubTaskRepo) StatByIDs(context.Context, []uuid.UUID) (map[uuid.UUID]*domain.TaskStats, error) {
	return nil, nil
}

func (s *stubTaskRepo) Info(context.Context, *domain.User, uuid.UUID, bool) (*db.Task, error) {
	return nil, nil
}

func (s *stubTaskRepo) List(context.Context, *domain.User, domain.TaskListReq) ([]*db.ProjectTask, *db.PageInfo, error) {
	return nil, nil, nil
}

func (s *stubTaskRepo) Create(ctx context.Context, _ *domain.User, _ domain.CreateTaskReq, _ string, _ func(*db.ProjectTask, *db.Model, *db.Image) (*taskflow.VirtualMachine, error)) (*db.ProjectTask, error) {
	s.seenLimit, s.seenLimitOK = entx.TaskConcurrencyLimitFromContext(ctx)
	return &db.ProjectTask{
		Edges: db.ProjectTaskEdges{
			Task: &db.Task{ID: uuid.New()},
		},
	}, nil
}

func (s *stubTaskRepo) Update(context.Context, *domain.User, uuid.UUID, func(*db.TaskUpdateOne) error) error {
	return nil
}

func (s *stubTaskRepo) Stop(context.Context, *domain.User, uuid.UUID, func(*db.Task) error) error {
	return nil
}

func (s *stubTaskRepo) Delete(context.Context, *domain.User, uuid.UUID) error {
	return nil
}

type stubTaskPolicy struct {
	limit int
	err   error
}

func (s *stubTaskPolicy) GetMaxConcurrent(context.Context, uuid.UUID) (int, error) {
	return s.limit, s.err
}

type stubTaskflowClient struct {
	hoster taskflow.Hoster
}

func (s *stubTaskflowClient) VirtualMachiner() taskflow.VirtualMachiner { return nil }
func (s *stubTaskflowClient) Host() taskflow.Hoster                     { return s.hoster }
func (s *stubTaskflowClient) FileManager() taskflow.FileManager         { return nil }
func (s *stubTaskflowClient) TaskManager() taskflow.TaskManager         { return nil }
func (s *stubTaskflowClient) PortForwarder() taskflow.PortForwarder     { return nil }
func (s *stubTaskflowClient) Stats(context.Context) (*taskflow.Stats, error) {
	return nil, nil
}
func (s *stubTaskflowClient) TaskLive(context.Context, string, bool, func(*taskflow.TaskChunk) error) error {
	return nil
}

type stubHoster struct {
	onlineMap map[string]bool
}

func (s *stubHoster) List(context.Context, string) (map[string]*taskflow.Host, error) {
	return nil, nil
}

func (s *stubHoster) IsOnline(_ context.Context, req *taskflow.IsOnlineReq[string]) (*taskflow.IsOnlineResp, error) {
	resp := &taskflow.IsOnlineResp{OnlineMap: map[string]bool{}}
	for _, id := range req.IDs {
		resp.OnlineMap[id] = s.onlineMap[id]
	}
	return resp, nil
}

type stubModelRepo struct{}

func (*stubModelRepo) Get(context.Context, uuid.UUID, uuid.UUID) (*db.Model, error) { return nil, nil }
func (*stubModelRepo) List(context.Context, uuid.UUID, domain.CursorReq) ([]*db.Model, *db.Cursor, error) {
	return nil, nil, nil
}
func (*stubModelRepo) Create(context.Context, uuid.UUID, *domain.CreateModelReq) (*db.Model, error) {
	return nil, nil
}
func (*stubModelRepo) Delete(context.Context, uuid.UUID, uuid.UUID) error { return nil }
func (*stubModelRepo) Update(context.Context, uuid.UUID, uuid.UUID, *domain.UpdateModelReq) error {
	return nil
}
func (*stubModelRepo) UpdateCheckResult(context.Context, uuid.UUID, bool, string) error { return nil }

type stubGitIdentityRepo struct{}

func (*stubGitIdentityRepo) Get(context.Context, uuid.UUID) (*db.GitIdentity, error) { return nil, nil }
func (*stubGitIdentityRepo) GetByUserID(context.Context, uuid.UUID, uuid.UUID) (*db.GitIdentity, error) {
	return nil, nil
}
func (*stubGitIdentityRepo) List(context.Context, uuid.UUID) ([]*db.GitIdentity, error) {
	return nil, nil
}
func (*stubGitIdentityRepo) Create(context.Context, uuid.UUID, *domain.AddGitIdentityReq) (*db.GitIdentity, error) {
	return nil, nil
}
func (*stubGitIdentityRepo) Update(context.Context, uuid.UUID, uuid.UUID, *domain.UpdateGitIdentityReq) error {
	return nil
}
func (*stubGitIdentityRepo) Delete(context.Context, uuid.UUID, uuid.UUID) error { return nil }
func (*stubGitIdentityRepo) CountProjectsByGitIdentityID(context.Context, uuid.UUID) (int, error) {
	return 0, nil
}
