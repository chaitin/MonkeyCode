package usecase

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/db/virtualmachine"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestVMIdleSchedulePlanFromPolicy(t *testing.T) {
	policy := &domain.TeamTaskVMIdlePolicy{
		TeamID:                  uuid.New(),
		SleepEnabled:            false,
		EffectiveSleepSeconds:   0,
		RecycleEnabled:          true,
		EffectiveRecycleSeconds: 3600,
	}
	schedules := []notifySchedule{{name: "default", lead: 600 * time.Second, leadSeconds: 600}}

	got := buildVMIdleSchedulePlan(policy, schedules)
	if got.SleepAt != nil {
		t.Fatalf("sleep should be disabled: %#v", got.SleepAt)
	}
	if got.RecycleAt == nil {
		t.Fatal("recycle should be scheduled")
	}
	if len(got.NotifyJobs) != 1 || got.NotifyJobs[0].MemberSuffix != "default" {
		t.Fatalf("notify jobs = %#v", got.NotifyJobs)
	}
}

func TestResolvePolicyForVMFallsBackToGlobalWhenTeamMissing(t *testing.T) {
	r := &vmIdleRefresher{
		cfg: &config.Config{VMIdle: config.VMIdle{SleepSeconds: 600, RecycleSeconds: 604800}},
	}
	vm := &db.VirtualMachine{ID: "vm-1"}

	got, err := r.resolvePolicyForVM(context.Background(), vm)
	if err != nil {
		t.Fatal(err)
	}
	if !got.SleepEnabled || got.EffectiveSleepSeconds != 600 {
		t.Fatalf("sleep policy = %#v", got)
	}
	if !got.RecycleEnabled || got.EffectiveRecycleSeconds != 604800 {
		t.Fatalf("recycle policy = %#v", got)
	}
}

func TestRefreshDebouncesBeforeVMQuery(t *testing.T) {
	ctx := context.Background()
	redisClient := newTestRedis(t)
	repo := &refreshHostRepoStub{
		vm: &db.VirtualMachine{ID: "vm-activity", UserID: uuid.New()},
	}
	r := &vmIdleRefresher{
		cfg:      &config.Config{VMIdle: config.VMIdle{SleepSeconds: 600, RecycleSeconds: 604800}},
		redis:    redisClient,
		logger:   slog.Default(),
		hostRepo: repo,
	}

	if err := r.Refresh(ctx, "vm-activity"); err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	if err := r.Refresh(ctx, "vm-activity"); err != nil {
		t.Fatalf("second refresh: %v", err)
	}
	if repo.getVirtualMachineCalls != 1 {
		t.Fatalf("GetVirtualMachine calls = %d, want 1", repo.getVirtualMachineCalls)
	}
}

func TestRefreshCachesNotFoundVM(t *testing.T) {
	ctx := context.Background()
	redisClient := newTestRedis(t)
	repo := &refreshHostRepoStub{err: newVirtualMachineNotFoundErr(t)}
	r := &vmIdleRefresher{
		cfg:      &config.Config{VMIdle: config.VMIdle{SleepSeconds: 600, RecycleSeconds: 604800}},
		redis:    redisClient,
		logger:   slog.Default(),
		hostRepo: repo,
	}

	if err := r.Refresh(ctx, "missing-vm"); err != nil {
		t.Fatalf("first refresh: %v", err)
	}
	if err := r.Refresh(ctx, "missing-vm"); err != nil {
		t.Fatalf("second refresh: %v", err)
	}
	if repo.getVirtualMachineCalls != 1 {
		t.Fatalf("GetVirtualMachine calls = %d, want 1", repo.getVirtualMachineCalls)
	}
}

func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	srv := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	t.Cleanup(func() {
		_ = client.Close()
	})
	return client
}

func newVirtualMachineNotFoundErr(t *testing.T) error {
	t.Helper()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:vmidle-not-found-%s?mode=memory&cache=shared&_fk=1", uuid.NewString()))
	defer client.Close()
	_, err := client.VirtualMachine.Query().
		Where(virtualmachine.ID("missing-vm")).
		First(context.Background())
	if err == nil {
		t.Fatal("expected not found error")
	}
	if !db.IsNotFound(err) {
		t.Fatalf("err = %v, want db not found", err)
	}
	return err
}

type refreshHostRepoStub struct {
	vm                     *db.VirtualMachine
	err                    error
	getVirtualMachineCalls int
}

func (s *refreshHostRepoStub) List(context.Context, uuid.UUID) ([]*db.Host, error) {
	return nil, errors.New("not implemented")
}

func (s *refreshHostRepoStub) GetHost(context.Context, uuid.UUID, string) (*domain.Host, error) {
	return nil, errors.New("not implemented")
}

func (s *refreshHostRepoStub) GetByID(context.Context, string) (*db.Host, error) {
	return nil, errors.New("not implemented")
}

func (s *refreshHostRepoStub) GetVirtualMachine(context.Context, string) (*db.VirtualMachine, error) {
	s.getVirtualMachineCalls++
	return s.vm, s.err
}

func (s *refreshHostRepoStub) GetVirtualMachineByAccessToken(context.Context, string) (*db.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}

func (s *refreshHostRepoStub) GetVirtualMachineByEnvID(context.Context, string) (*db.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}

func (s *refreshHostRepoStub) GetTaskIDByVMID(context.Context, string) (string, error) {
	return "", errors.New("not implemented")
}

func (s *refreshHostRepoStub) BatchGetVmIDsByEnvironmentIDs(context.Context, []string) (map[string]string, error) {
	return nil, errors.New("not implemented")
}

func (s *refreshHostRepoStub) GetVirtualMachineWithUser(context.Context, uuid.UUID, string) (*db.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}

func (s *refreshHostRepoStub) CreateVirtualMachine(context.Context, *domain.User, *domain.CreateVMReq, func(context.Context) (string, error), func(*db.Model, *db.Image) (*domain.VirtualMachine, error)) (*domain.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}

func (s *refreshHostRepoStub) PrepareCreateVirtualMachine(context.Context, *domain.User, *domain.CreateVMReq, string) (*domain.PreparedVirtualMachine, error) {
	return nil, errors.New("not implemented")
}

func (s *refreshHostRepoStub) CompleteCreateVirtualMachine(context.Context, string, *taskflow.VirtualMachine) (*domain.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}

func (s *refreshHostRepoStub) PastHourVirtualMachine(context.Context) ([]*db.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}

func (s *refreshHostRepoStub) AllCountDownVirtualMachine(context.Context) ([]*db.VirtualMachine, error) {
	return nil, errors.New("not implemented")
}

func (s *refreshHostRepoStub) DeleteVirtualMachine(context.Context, uuid.UUID, string, string, func(*db.VirtualMachine) error) error {
	return errors.New("not implemented")
}

func (s *refreshHostRepoStub) UpsertVirtualMachine(context.Context, *taskflow.VirtualMachine) error {
	return errors.New("not implemented")
}

func (s *refreshHostRepoStub) UpdateVirtualMachine(context.Context, string, func(*db.VirtualMachineUpdateOne) error) error {
	return errors.New("not implemented")
}

func (s *refreshHostRepoStub) UpsertHost(context.Context, *taskflow.Host) error {
	return errors.New("not implemented")
}

func (s *refreshHostRepoStub) DeleteHost(context.Context, uuid.UUID, string) error {
	return errors.New("not implemented")
}

func (s *refreshHostRepoStub) UpdateHost(context.Context, uuid.UUID, *domain.UpdateHostReq) error {
	return errors.New("not implemented")
}

func (s *refreshHostRepoStub) UpdateVM(context.Context, domain.UpdateVMReq, func(*db.VirtualMachine) error) (*db.VirtualMachine, int64, error) {
	return nil, 0, errors.New("not implemented")
}

func (s *refreshHostRepoStub) GetGitCredentialByTask(context.Context, string) (*domain.GitCredentialInfo, error) {
	return nil, errors.New("not implemented")
}
