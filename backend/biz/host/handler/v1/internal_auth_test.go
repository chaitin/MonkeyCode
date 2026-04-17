package v1

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestAgentAuthRecycledVMTriggersDeleteOnce(t *testing.T) {
	rdb := newTestRedis(t)
	vmClient := &vmDeleterStub{ch: make(chan struct{}, 1)}
	handler := &InternalHostHandler{
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		getAgentToken: func(context.Context, string) (string, error) { return "", redis.Nil },
		repo: &internalHostRepoStub{
			vm: &db.VirtualMachine{
				ID:            "agent_1",
				HostID:        "host_1",
				EnvironmentID: "env_1",
				MachineID:     "bound-machine",
				UserID:        uuid.MustParse("11111111-1111-1111-1111-111111111111"),
				IsRecycled:    true,
			},
		},
		vmDeleter:      vmClient,
		limiter:        rdb,
		skipSoftDelete: func(ctx context.Context) context.Context { return ctx },
	}

	_, err := handler.agentAuth(context.Background(), "agent_1", "machine-1")
	if !errors.Is(err, errAgentVMRecycled) {
		t.Fatalf("agent auth error = %v, want %v", err, errAgentVMRecycled)
	}
	reqs := vmClient.waitReqs(t, time.Second)
	if len(reqs) != 1 {
		t.Fatalf("delete calls = %d, want 1", len(vmClient.reqs))
	}
	if reqs[0].ID != "env_1" {
		t.Fatalf("delete env id = %q, want env_1", reqs[0].ID)
	}
}

func TestAgentAuthRecycledVMLimitedSkipsDelete(t *testing.T) {
	rdb := newTestRedis(t)
	if ok, err := rdb.SetNX(context.Background(), "vm:recycle:retry:agent_2", "1", time.Minute).Result(); err != nil || !ok {
		t.Fatalf("seed redis limiter failed, ok=%v err=%v", ok, err)
	}
	vmClient := &vmDeleterStub{ch: make(chan struct{}, 1)}
	handler := &InternalHostHandler{
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		getAgentToken: func(context.Context, string) (string, error) { return "", redis.Nil },
		repo: &internalHostRepoStub{
			vm: &db.VirtualMachine{
				ID:            "agent_2",
				HostID:        "host_2",
				EnvironmentID: "env_2",
				MachineID:     "bound-machine",
				UserID:        uuid.MustParse("22222222-2222-2222-2222-222222222222"),
				IsRecycled:    true,
			},
		},
		vmDeleter:      vmClient,
		limiter:        rdb,
		skipSoftDelete: func(ctx context.Context) context.Context { return ctx },
	}

	_, err := handler.agentAuth(context.Background(), "agent_2", "machine-2")
	if !errors.Is(err, errAgentVMRecycled) {
		t.Fatalf("agent auth error = %v, want %v", err, errAgentVMRecycled)
	}
	if vmClient.hasReqWithin(50 * time.Millisecond) {
		t.Fatalf("delete calls = %d, want 0", len(vmClient.reqs))
	}
}

func TestAgentAuthSoftDeletedRecycledVMStillTriggersDelete(t *testing.T) {
	rdb := newTestRedis(t)
	vmClient := &vmDeleterStub{ch: make(chan struct{}, 1)}
	skipCalled := false
	type testSkipMarkerKey struct{}
	markerKey := testSkipMarkerKey{}
	const markerValue = "skip-soft-delete-visible"
	repo := &internalHostRepoStub{
		vm: &db.VirtualMachine{
			ID:            "agent_deleted",
			HostID:        "host_deleted",
			EnvironmentID: "env_deleted",
			UserID:        uuid.MustParse("33333333-3333-3333-3333-333333333333"),
			IsRecycled:    true,
		},
		assertSkipMarker: true,
		skipMarkerKey:    markerKey,
		skipMarkerValue:  markerValue,
	}
	handler := &InternalHostHandler{
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		getAgentToken: func(context.Context, string) (string, error) { return "", redis.Nil },
		repo:          repo,
		vmDeleter:     vmClient,
		limiter:       rdb,
		skipSoftDelete: func(ctx context.Context) context.Context {
			skipCalled = true
			return context.WithValue(ctx, markerKey, markerValue)
		},
	}

	_, err := handler.agentAuth(context.Background(), "agent_deleted", "machine-deleted")
	if !errors.Is(err, errAgentVMRecycled) {
		t.Fatalf("agent auth error = %v, want %v", err, errAgentVMRecycled)
	}
	if !skipCalled {
		t.Fatal("expected skipSoftDelete to be called")
	}
	if len(vmClient.waitReqs(t, time.Second)) != 1 {
		t.Fatalf("delete calls = %d, want 1", len(vmClient.reqs))
	}
}

type internalHostRepoStub struct {
	vm               *db.VirtualMachine
	assertSkipMarker bool
	skipMarkerKey    interface{}
	skipMarkerValue  string
}

func (s *internalHostRepoStub) List(context.Context, uuid.UUID) ([]*db.Host, error) {
	return nil, errors.New("not implemented")
}

func (s *internalHostRepoStub) GetHost(context.Context, uuid.UUID, string) (*domain.Host, error) {
	return nil, errors.New("not implemented")
}

func (s *internalHostRepoStub) UpsertHost(context.Context, *taskflow.Host) error {
	return nil
}

func (s *internalHostRepoStub) UpsertVirtualMachine(context.Context, *taskflow.VirtualMachine) error {
	return nil
}

func (s *internalHostRepoStub) GetVirtualMachine(ctx context.Context, _ string) (*db.VirtualMachine, error) {
	if s.assertSkipMarker {
		v, ok := ctx.Value(s.skipMarkerKey).(string)
		if !ok || v != s.skipMarkerValue {
			return nil, errors.New("skip soft delete context marker missing")
		}
	}
	if s.vm == nil {
		return nil, errors.New("vm not found")
	}
	return s.vm, nil
}

func (s *internalHostRepoStub) UpdateVirtualMachine(context.Context, string, func(*db.VirtualMachineUpdateOne) error) error {
	return nil
}

func (s *internalHostRepoStub) GetByID(context.Context, string) (*db.Host, error) {
	return nil, errors.New("host not found")
}

func (s *internalHostRepoStub) GetVirtualMachineByEnvID(context.Context, string) (*db.VirtualMachine, error) {
	return nil, errors.New("vm not found")
}

func (s *internalHostRepoStub) GetVirtualMachineWithUser(context.Context, uuid.UUID, string) (*db.VirtualMachine, error) {
	return nil, errors.New("vm not found")
}

func (s *internalHostRepoStub) CreateVirtualMachine(context.Context, *domain.User, *domain.CreateVMReq, func(context.Context) (string, error), func(*db.Model, *db.Image) (*domain.VirtualMachine, error)) (*domain.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}

func (s *internalHostRepoStub) PastHourVirtualMachine(context.Context) ([]*db.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}

func (s *internalHostRepoStub) AllCountDownVirtualMachine(context.Context) ([]*db.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}

func (s *internalHostRepoStub) DeleteVirtualMachine(context.Context, uuid.UUID, string, string, func(*db.VirtualMachine) error) error {
	return errors.New("not implemented")
}

func (s *internalHostRepoStub) DeleteHost(context.Context, uuid.UUID, string) error {
	return errors.New("not implemented")
}

func (s *internalHostRepoStub) UpdateHost(context.Context, uuid.UUID, *domain.UpdateHostReq) error {
	return errors.New("not implemented")
}

func (s *internalHostRepoStub) UpdateVM(context.Context, domain.UpdateVMReq, func(*db.VirtualMachine) error) (*db.VirtualMachine, int64, error) {
	return nil, 0, errors.New("not implemented")
}

func (s *internalHostRepoStub) GetGitCredentialByTask(context.Context, string) (*domain.GitCredentialInfo, error) {
	return nil, errors.New("task not found")
}

type vmDeleterStub struct {
	reqs []*taskflow.DeleteVirtualMachineReq
	err  error
	ch   chan struct{}
}

func (s *vmDeleterStub) Delete(_ context.Context, req *taskflow.DeleteVirtualMachineReq) error {
	cp := *req
	s.reqs = append(s.reqs, &cp)
	if s.ch != nil {
		select {
		case s.ch <- struct{}{}:
		default:
		}
	}
	return s.err
}

func (s *vmDeleterStub) Create(context.Context, *taskflow.CreateVirtualMachineReq) (*taskflow.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}

func (s *vmDeleterStub) Hibernate(context.Context, *taskflow.HibernateVirtualMachineReq) error {
	return errors.New("not implemented")
}

func (s *vmDeleterStub) Resume(context.Context, *taskflow.ResumeVirtualMachineReq) error {
	return errors.New("not implemented")
}

func (s *vmDeleterStub) List(context.Context, string) ([]*taskflow.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}

func (s *vmDeleterStub) Info(context.Context, taskflow.VirtualMachineInfoReq) (*taskflow.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}

func (s *vmDeleterStub) Terminal(context.Context, *taskflow.TerminalReq) (taskflow.Sheller, error) {
	return nil, errors.New("not implemented")
}

func (s *vmDeleterStub) Reports(context.Context, taskflow.ReportSubscribeReq) (taskflow.Reporter, error) {
	return nil, errors.New("not implemented")
}

func (s *vmDeleterStub) TerminalList(context.Context, string) ([]*taskflow.Terminal, error) {
	return nil, errors.New("not implemented")
}

func (s *vmDeleterStub) CloseTerminal(context.Context, *taskflow.CloseTerminalReq) error {
	return errors.New("not implemented")
}

func (s *vmDeleterStub) IsOnline(context.Context, *taskflow.IsOnlineReq[string]) (*taskflow.IsOnlineResp, error) {
	return nil, errors.New("not implemented")
}

func (s *vmDeleterStub) waitReqs(t *testing.T, timeout time.Duration) []*taskflow.DeleteVirtualMachineReq {
	t.Helper()
	select {
	case <-s.ch:
		return s.reqs
	case <-time.After(timeout):
		t.Fatal("timed out waiting for delete call")
		return nil
	}
}

func (s *vmDeleterStub) hasReqWithin(timeout time.Duration) bool {
	select {
	case <-s.ch:
		return true
	case <-time.After(timeout):
		return false
	}
}

func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	t.Cleanup(mr.Close)

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() {
		_ = rdb.Close()
	})
	return rdb
}
