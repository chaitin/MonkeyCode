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
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
	"github.com/chaitin/MonkeyCode/backend/pkg/vmrecycle"
)

func TestVMIdleSchedulePlanUsesSingleNow(t *testing.T) {
	now := time.Date(2026, 7, 13, 10, 0, 0, 123, time.UTC)
	policy := &domain.TeamTaskVMIdlePolicy{
		TeamID:                  uuid.New(),
		SleepEnabled:            true,
		EffectiveSleepSeconds:   600,
		RecycleEnabled:          true,
		EffectiveRecycleSeconds: 3600,
	}
	schedules := []notifySchedule{{name: "default", lead: 600 * time.Second, leadSeconds: 600}}

	got := buildVMIdleSchedulePlan(policy, schedules, now)
	if got.SleepAt == nil || !got.SleepAt.Equal(now.Add(600*time.Second)) {
		t.Fatalf("sleep at = %v, want %v", got.SleepAt, now.Add(600*time.Second))
	}
	if got.RecycleAt == nil || !got.RecycleAt.Equal(now.Add(3600*time.Second)) {
		t.Fatalf("recycle at = %v, want %v", got.RecycleAt, now.Add(3600*time.Second))
	}
	if len(got.NotifyJobs) != 1 || got.NotifyJobs[0].MemberSuffix != "default" {
		t.Fatalf("notify jobs = %#v", got.NotifyJobs)
	}
	if !got.NotifyJobs[0].RunAt.Equal(now.Add(3000 * time.Second)) {
		t.Fatalf("notify at = %v, want %v", got.NotifyJobs[0].RunAt, now.Add(3000*time.Second))
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

func TestRecordActivityDebouncesBeforeVMQuery(t *testing.T) {
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

	if err := r.RecordActivity(ctx, "vm-activity"); err != nil {
		t.Fatalf("first activity: %v", err)
	}
	if err := r.RecordActivity(ctx, "vm-activity"); err != nil {
		t.Fatalf("second activity: %v", err)
	}
	if repo.getVirtualMachineCalls != 1 {
		t.Fatalf("GetVirtualMachine calls = %d, want 1", repo.getVirtualMachineCalls)
	}
}

func TestKeepAwakeAndRecordActivityDebounceIndependently(t *testing.T) {
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

	if err := r.KeepAwake(ctx, "vm-activity"); err != nil {
		t.Fatalf("keep awake: %v", err)
	}
	if err := r.RecordActivity(ctx, "vm-activity"); err != nil {
		t.Fatalf("record activity: %v", err)
	}
	if repo.getVirtualMachineCalls != 2 {
		t.Fatalf("GetVirtualMachine calls = %d, want 2", repo.getVirtualMachineCalls)
	}
	for _, key := range []string{
		"vm:idle:debounce:vm-activity:keep-awake",
		"vm:idle:debounce:vm-activity:activity",
	} {
		if exists, err := redisClient.Exists(ctx, key).Result(); err != nil || exists != 1 {
			t.Fatalf("debounce key %q exists = %d, err = %v", key, exists, err)
		}
	}
}

func TestRecordActivityCachesNotFoundVM(t *testing.T) {
	ctx := context.Background()
	redisClient := newTestRedis(t)
	repo := &refreshHostRepoStub{err: newVirtualMachineNotFoundErr(t)}
	r := &vmIdleRefresher{
		cfg:      &config.Config{VMIdle: config.VMIdle{SleepSeconds: 600, RecycleSeconds: 604800}},
		redis:    redisClient,
		logger:   slog.Default(),
		hostRepo: repo,
	}

	if err := r.RecordActivity(ctx, "missing-vm"); err != nil {
		t.Fatalf("first activity: %v", err)
	}
	if err := r.RecordActivity(ctx, "missing-vm"); err != nil {
		t.Fatalf("second activity: %v", err)
	}
	if repo.getVirtualMachineCalls != 1 {
		t.Fatalf("GetVirtualMachine calls = %d, want 1", repo.getVirtualMachineCalls)
	}
}

func TestKeepAwakeOnlyUpdatesSleepSchedule(t *testing.T) {
	ctx := context.Background()
	redisClient := newTestRedis(t)
	vmID := "vm-keep-awake"
	vm := &db.VirtualMachine{ID: vmID, UserID: uuid.New(), HostID: "host-1", EnvironmentID: "env-1"}
	vm.Edges.Tasks = []*db.Task{{ID: uuid.New()}}
	r := newQueueTestVMIdleRefresher(redisClient, &refreshHostRepoStub{vm: vm})
	oldRecycleAt := time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC)
	payload := &domain.VmIdleInfo{VmID: vmID, RecycleAt: oldRecycleAt}
	oldNotifyAt := oldRecycleAt.Add(-10 * time.Minute)
	if _, err := r.notifyQueue.Enqueue(ctx, vmrecycle.NotifyQueueKey, payload, oldNotifyAt, vmID+":default"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.recycleQueue.Enqueue(ctx, vmrecycle.RecycleQueueKey, payload, oldRecycleAt, vmID); err != nil {
		t.Fatal(err)
	}

	before := time.Now()
	if err := r.KeepAwake(ctx, vmID); err != nil {
		t.Fatal(err)
	}
	after := time.Now()

	assertVMIdleJobBetween(t, r.sleepQueue.RedisDelayQueue, ctx, vmrecycle.SleepQueueKey, vmID, before.Add(10*time.Minute), after.Add(10*time.Minute))
	assertVMIdleJobAt(t, r.notifyQueue.RedisDelayQueue, ctx, vmrecycle.NotifyQueueKey, vmID+":default", oldNotifyAt)
	assertVMIdleJobAt(t, r.recycleQueue.RedisDelayQueue, ctx, vmrecycle.RecycleQueueKey, vmID, oldRecycleAt)
}

func TestRecordActivityUpdatesAllSchedules(t *testing.T) {
	ctx := context.Background()
	redisClient := newTestRedis(t)
	vmID := "vm-record-activity"
	vm := &db.VirtualMachine{ID: vmID, UserID: uuid.New(), HostID: "host-1", EnvironmentID: "env-1"}
	vm.Edges.Tasks = []*db.Task{{ID: uuid.New()}}
	r := newQueueTestVMIdleRefresher(redisClient, &refreshHostRepoStub{vm: vm})

	before := time.Now()
	if err := r.RecordActivity(ctx, vmID); err != nil {
		t.Fatal(err)
	}
	after := time.Now()

	assertVMIdleJobBetween(t, r.sleepQueue.RedisDelayQueue, ctx, vmrecycle.SleepQueueKey, vmID, before.Add(10*time.Minute), after.Add(10*time.Minute))
	assertVMIdleJobBetween(t, r.notifyQueue.RedisDelayQueue, ctx, vmrecycle.NotifyQueueKey, vmID+":default", before.Add(50*time.Minute), after.Add(50*time.Minute))
	assertVMIdleJobBetween(t, r.recycleQueue.RedisDelayQueue, ctx, vmrecycle.RecycleQueueKey, vmID, before.Add(time.Hour), after.Add(time.Hour))
}

func TestKeepAwakeWithSleepDisabledOnlyRemovesSleepSchedule(t *testing.T) {
	ctx := context.Background()
	redisClient := newTestRedis(t)
	vmID := "vm-sleep-disabled"
	vm := &db.VirtualMachine{ID: vmID, UserID: uuid.New(), HostID: "host-1", EnvironmentID: "env-1"}
	vm.Edges.Tasks = []*db.Task{{ID: uuid.New()}}
	r := newQueueTestVMIdleRefresher(redisClient, &refreshHostRepoStub{vm: vm})
	r.teamPolicyRepo = &refreshTeamPolicyRepoStub{team: &db.Team{
		ID:                   uuid.New(),
		TaskConcurrencyLimit: 3,
		TaskVMSleepEnabled:   false,
		TaskVMRecycleEnabled: true,
		TaskVMRecycleSeconds: 3600,
	}}
	oldRecycleAt := time.Date(2026, 7, 20, 10, 0, 0, 0, time.UTC)
	payload := &domain.VmIdleInfo{VmID: vmID, RecycleAt: oldRecycleAt}
	oldSleepAt := oldRecycleAt.Add(-50 * time.Minute)
	oldNotifyAt := oldRecycleAt.Add(-10 * time.Minute)
	if _, err := r.sleepQueue.Enqueue(ctx, vmrecycle.SleepQueueKey, payload, oldSleepAt, vmID); err != nil {
		t.Fatal(err)
	}
	if _, err := r.notifyQueue.Enqueue(ctx, vmrecycle.NotifyQueueKey, payload, oldNotifyAt, vmID+":default"); err != nil {
		t.Fatal(err)
	}
	if _, err := r.recycleQueue.Enqueue(ctx, vmrecycle.RecycleQueueKey, payload, oldRecycleAt, vmID); err != nil {
		t.Fatal(err)
	}

	if err := r.KeepAwake(ctx, vmID); err != nil {
		t.Fatal(err)
	}
	if _, _, ok, err := r.sleepQueue.GetJobInfo(ctx, vmrecycle.SleepQueueKey, vmID); err != nil || ok {
		t.Fatalf("sleep job ok = %v, err = %v, want removed", ok, err)
	}
	assertVMIdleJobAt(t, r.notifyQueue.RedisDelayQueue, ctx, vmrecycle.NotifyQueueKey, vmID+":default", oldNotifyAt)
	assertVMIdleJobAt(t, r.recycleQueue.RedisDelayQueue, ctx, vmrecycle.RecycleQueueKey, vmID, oldRecycleAt)
}

func TestRecycleJobMarksVMRecycledAfterFinalRemoteDeleteFailure(t *testing.T) {
	repo := &refreshHostRepoStub{}
	r := &vmIdleRefresher{
		logger:       slog.Default(),
		hostRepo:     repo,
		recycleQueue: delayqueue.NewVMRecycleQueue(newTestRedis(t), slog.Default()),
		recycler:     &idleRecyclerStub{err: fmt.Errorf("%w: taskflow unavailable", vmrecycle.ErrRemoteDelete)},
	}
	job := &delayqueue.Job[*domain.VmIdleInfo]{
		Payload:  &domain.VmIdleInfo{VmID: "vm-final"},
		Attempts: 4,
	}

	if err := r.handleRecycleJob(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	if repo.updateVirtualMachineCalls != 1 || !repo.isRecycled {
		t.Fatalf("update calls = %d, is recycled = %v", repo.updateVirtualMachineCalls, repo.isRecycled)
	}
}

func TestRecycleJobDoesNotMarkVMBeforeFinalAttempt(t *testing.T) {
	wantErr := fmt.Errorf("%w: taskflow unavailable", vmrecycle.ErrRemoteDelete)
	repo := &refreshHostRepoStub{}
	r := &vmIdleRefresher{
		logger:       slog.Default(),
		hostRepo:     repo,
		recycleQueue: delayqueue.NewVMRecycleQueue(newTestRedis(t), slog.Default()),
		recycler:     &idleRecyclerStub{err: wantErr},
	}
	job := &delayqueue.Job[*domain.VmIdleInfo]{
		Payload:  &domain.VmIdleInfo{VmID: "vm-retry"},
		Attempts: 3,
	}

	err := r.handleRecycleJob(context.Background(), job)
	if !errors.Is(err, wantErr) {
		t.Fatalf("error = %v, want %v", err, wantErr)
	}
	if repo.updateVirtualMachineCalls != 0 {
		t.Fatalf("update calls = %d, want 0", repo.updateVirtualMachineCalls)
	}
}

func TestRecycleJobDoesNotMarkVMForNonRemoteFailure(t *testing.T) {
	wantErr := errors.New("database unavailable")
	repo := &refreshHostRepoStub{}
	r := &vmIdleRefresher{
		logger:       slog.Default(),
		hostRepo:     repo,
		recycleQueue: delayqueue.NewVMRecycleQueue(newTestRedis(t), slog.Default()),
		recycler:     &idleRecyclerStub{err: wantErr},
	}
	job := &delayqueue.Job[*domain.VmIdleInfo]{
		Payload:  &domain.VmIdleInfo{VmID: "vm-database-error"},
		Attempts: 4,
	}

	err := r.handleRecycleJob(context.Background(), job)
	if !errors.Is(err, wantErr) {
		t.Fatalf("error = %v, want %v", err, wantErr)
	}
	if repo.updateVirtualMachineCalls != 0 {
		t.Fatalf("update calls = %d, want 0", repo.updateVirtualMachineCalls)
	}
}

func TestRecycleJobRetriesMarkWithoutDeletingRemotelyAgain(t *testing.T) {
	remoteErr := fmt.Errorf("%w: taskflow unavailable", vmrecycle.ErrRemoteDelete)
	markErr := errors.New("database unavailable")
	repo := &refreshHostRepoStub{updateVirtualMachineErr: markErr}
	recycler := &idleRecyclerStub{err: remoteErr}
	r := &vmIdleRefresher{
		logger:       slog.Default(),
		hostRepo:     repo,
		recycleQueue: delayqueue.NewVMRecycleQueue(newTestRedis(t), slog.Default()),
		recycler:     recycler,
	}
	job := &delayqueue.Job[*domain.VmIdleInfo]{
		Payload:  &domain.VmIdleInfo{VmID: "vm-mark-retry"},
		Attempts: 4,
	}

	err := r.handleRecycleJob(context.Background(), job)
	if !errors.Is(err, remoteErr) || !errors.Is(err, markErr) || !errors.Is(err, delayqueue.ErrRetryAfterMaxAttempts) {
		t.Fatalf("error = %v, want remote, database and persistent retry errors", err)
	}
	if !job.Payload.RecycleDeleteExhausted || recycler.calls != 1 {
		t.Fatalf("delete exhausted = %v, recycle calls = %d", job.Payload.RecycleDeleteExhausted, recycler.calls)
	}

	repo.updateVirtualMachineErr = nil
	if err := r.handleRecycleJob(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	if recycler.calls != 1 {
		t.Fatalf("recycle calls = %d, want 1", recycler.calls)
	}
	if repo.updateVirtualMachineCalls != 2 || !repo.isRecycled {
		t.Fatalf("update calls = %d, is recycled = %v", repo.updateVirtualMachineCalls, repo.isRecycled)
	}
}

func newQueueTestVMIdleRefresher(redisClient *redis.Client, repo domain.HostRepo) *vmIdleRefresher {
	logger := slog.Default()
	return &vmIdleRefresher{
		cfg:          &config.Config{VMIdle: config.VMIdle{SleepSeconds: 600, RecycleSeconds: 3600}},
		redis:        redisClient,
		logger:       logger,
		hostRepo:     repo,
		sleepQueue:   delayqueue.NewVMSleepQueue(redisClient, logger),
		notifyQueue:  delayqueue.NewVMNotifyQueue(redisClient, logger),
		recycleQueue: delayqueue.NewVMRecycleQueue(redisClient, logger),
		schedules:    []notifySchedule{{name: "default", lead: 10 * time.Minute, leadSeconds: 600}},
	}
}

func assertVMIdleJobAt(t *testing.T, queue *delayqueue.RedisDelayQueue[*domain.VmIdleInfo], ctx context.Context, queueKey, id string, want time.Time) {
	t.Helper()
	_, got, ok, err := queue.GetJobInfo(ctx, queueKey, id)
	if err != nil || !ok {
		t.Fatalf("job %q ok = %v, err = %v", id, ok, err)
	}
	if !got.Equal(want) {
		t.Fatalf("job %q run at = %v, want %v", id, got, want)
	}
}

func assertVMIdleJobBetween(t *testing.T, queue *delayqueue.RedisDelayQueue[*domain.VmIdleInfo], ctx context.Context, queueKey, id string, earliest, latest time.Time) {
	t.Helper()
	_, got, ok, err := queue.GetJobInfo(ctx, queueKey, id)
	if err != nil || !ok {
		t.Fatalf("job %q ok = %v, err = %v", id, ok, err)
	}
	if got.Before(earliest.Add(-time.Second)) || got.After(latest.Add(time.Second)) {
		t.Fatalf("job %q run at = %v, want between %v and %v", id, got, earliest, latest)
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
	vm                        *db.VirtualMachine
	err                       error
	updateVirtualMachineErr   error
	getVirtualMachineCalls    int
	updateVirtualMachineCalls int
	isRecycled                bool
}

type idleRecyclerStub struct {
	err   error
	calls int
}

func (s *idleRecyclerStub) Recycle(_ context.Context, vmID string) (vmrecycle.Result, error) {
	s.calls++
	return vmrecycle.Result{VMID: vmID}, s.err
}

type refreshTeamPolicyRepoStub struct {
	team *db.Team
}

func (s *refreshTeamPolicyRepoStub) GetTeam(context.Context, uuid.UUID) (*db.Team, error) {
	return nil, errors.New("not implemented")
}

func (s *refreshTeamPolicyRepoStub) GetTeamByUserID(context.Context, uuid.UUID) (*db.Team, error) {
	return s.team, nil
}

func (s *refreshTeamPolicyRepoStub) UpdateTaskVMIdlePolicy(context.Context, uuid.UUID, *domain.UpdateTeamTaskVMIdlePolicyReq) (*db.Team, error) {
	return nil, errors.New("not implemented")
}

func (s *refreshTeamPolicyRepoStub) GetMember(context.Context, uuid.UUID, uuid.UUID) (*db.TeamMember, error) {
	return nil, errors.New("not implemented")
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

func (s *refreshHostRepoStub) UpdateVirtualMachine(_ context.Context, id string, fn func(*db.VirtualMachineUpdateOne) error) error {
	s.updateVirtualMachineCalls++
	if s.updateVirtualMachineErr != nil {
		return s.updateVirtualMachineErr
	}
	up := db.NewClient().VirtualMachine.UpdateOneID(id)
	if err := fn(up); err != nil {
		return err
	}
	s.isRecycled, _ = up.Mutation().IsRecycled()
	return nil
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
