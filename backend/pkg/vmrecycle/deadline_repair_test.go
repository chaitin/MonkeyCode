package vmrecycle

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	_ "github.com/mattn/go-sqlite3"
)

func TestDeadlineRepairerCreatesDeadlineFromCurrentPolicy(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC)
	client, vm := createDeadlineRepairVM(t, consts.TaskStatusProcessing, false)
	queue := delayqueue.NewVMRecycleQueue(newTestRedis(t), slog.New(slog.NewTextHandler(io.Discard, nil)))
	repairer := newDeadlineRepairerForTest(client, queue, now, true)

	result, err := repairer.Repair(ctx, vm.ID)
	if err != nil {
		t.Fatal(err)
	}
	wantRecycleAt := now.Add(24 * time.Hour)
	if !result.Repaired || !result.RecycleAt.Equal(wantRecycleAt) {
		t.Fatalf("result = %+v", result)
	}
	job, runAt, ok, err := queue.GetJobInfo(ctx, RecycleQueueKey, vm.ID)
	if err != nil || !ok {
		t.Fatalf("GetJobInfo() ok = %v, err = %v", ok, err)
	}
	if job.Payload.VmID != vm.ID || job.Payload.UID != vm.UserID || !job.Payload.RecycleAt.Equal(wantRecycleAt) || !runAt.Equal(wantRecycleAt) {
		t.Fatalf("job = %+v, run at = %v", job, runAt)
	}
}

func TestDeadlineRepairerDoesNotOverwriteConcurrentDeadline(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC)
	client, vm := createDeadlineRepairVM(t, consts.TaskStatusPending, false)
	queue := delayqueue.NewVMRecycleQueue(newTestRedis(t), slog.New(slog.NewTextHandler(io.Discard, nil)))
	existingAt := now.Add(2 * time.Hour)
	if _, err := queue.Enqueue(ctx, RecycleQueueKey, &domain.VmIdleInfo{VmID: vm.ID, RecycleAt: existingAt}, existingAt, vm.ID); err != nil {
		t.Fatal(err)
	}
	repairer := newDeadlineRepairerForTest(client, queue, now, true)

	result, err := repairer.Repair(ctx, vm.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Repaired || !result.RecycleAt.Equal(existingAt) {
		t.Fatalf("result = %+v", result)
	}
	job, runAt, ok, err := queue.GetJobInfo(ctx, RecycleQueueKey, vm.ID)
	if err != nil || !ok || !runAt.Equal(existingAt) || !job.Payload.RecycleAt.Equal(existingAt) {
		t.Fatalf("job = %+v, run at = %v, ok = %v, err = %v", job, runAt, ok, err)
	}
}

func TestDeadlineRepairerRevalidatesVMAndPolicy(t *testing.T) {
	tests := []struct {
		name           string
		status         consts.TaskStatus
		recycled       bool
		recycleEnabled bool
		want           string
	}{
		{name: "terminal task", status: consts.TaskStatusFinished, recycleEnabled: true, want: "no non-terminal task"},
		{name: "recycled VM", status: consts.TaskStatusProcessing, recycled: true, recycleEnabled: true, want: "already recycled"},
		{name: "disabled policy", status: consts.TaskStatusProcessing, recycleEnabled: false, want: "recycle disabled"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, vm := createDeadlineRepairVM(t, tt.status, tt.recycled)
			queue := delayqueue.NewVMRecycleQueue(newTestRedis(t), slog.New(slog.NewTextHandler(io.Discard, nil)))
			repairer := newDeadlineRepairerForTest(client, queue, time.Now(), tt.recycleEnabled)

			_, err := repairer.Repair(context.Background(), vm.ID)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %v, want containing %q", err, tt.want)
			}
			if _, ok, queueErr := queue.GetRunAt(context.Background(), RecycleQueueKey, vm.ID); queueErr != nil || ok {
				t.Fatalf("deadline ok = %v, error = %v", ok, queueErr)
			}
		})
	}
}

func createDeadlineRepairVM(t *testing.T, status consts.TaskStatus, recycled bool) (*db.Client, *db.VirtualMachine) {
	t.Helper()
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:deadline-repair-%s?mode=memory&cache=shared&_fk=1", uuid.NewString()))
	t.Cleanup(func() { _ = client.Close() })
	userID := uuid.New()
	if _, err := client.User.Create().SetID(userID).SetName("tester").SetRole(consts.UserRoleIndividual).SetStatus(consts.UserStatusActive).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Host.Create().SetID("host-1").SetUserID(userID).SetHostname("host").Save(ctx); err != nil {
		t.Fatal(err)
	}
	vm, err := client.VirtualMachine.Create().SetID("vm-1").SetHostID("host-1").SetUserID(userID).SetName("vm").SetIsRecycled(recycled).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	task, err := client.Task.Create().SetID(uuid.New()).SetUserID(userID).SetKind(consts.TaskTypeDevelop).SetContent("content").SetStatus(status).Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.TaskVirtualMachine.Create().SetID(uuid.New()).SetTaskID(task.ID).SetVirtualmachineID(vm.ID).Save(ctx); err != nil {
		t.Fatal(err)
	}
	return client, vm
}

func newDeadlineRepairerForTest(client *db.Client, queue deadlineQueue, now time.Time, recycleEnabled bool) *deadlineRepairer {
	return &deadlineRepairer{
		cfg: &config.Config{VMIdle: config.VMIdle{SleepSeconds: 600, RecycleSeconds: 86400}},
		db:  client,
		teamPolicyRepo: &analyzerTeamPolicyRepoStub{team: &db.Team{
			ID:                   uuid.New(),
			TaskConcurrencyLimit: 3,
			TaskVMSleepEnabled:   true,
			TaskVMSleepSeconds:   600,
			TaskVMRecycleEnabled: recycleEnabled,
			TaskVMRecycleSeconds: 0,
		}},
		queue: queue,
		now:   func() time.Time { return now },
	}
}
