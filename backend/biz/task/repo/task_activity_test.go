package repo

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
)

func TestRefreshLastActiveAtByVMIDUpdatesOnlyActiveTasks(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:task-vm-activity-%s?mode=memory&cache=shared&_fk=1", uuid.NewString()))
	t.Cleanup(func() { _ = client.Close() })

	userID := uuid.New()
	if _, err := client.User.Create().SetID(userID).SetName("tester").SetRole(consts.UserRoleIndividual).SetStatus(consts.UserStatusActive).Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Host.Create().SetID("host-1").SetUserID(userID).SetHostname("host").Save(ctx); err != nil {
		t.Fatal(err)
	}
	for _, vmID := range []string{"vm-active", "vm-other"} {
		if _, err := client.VirtualMachine.Create().SetID(vmID).SetHostID("host-1").SetUserID(userID).SetName(vmID).Save(ctx); err != nil {
			t.Fatal(err)
		}
	}

	old := time.Date(2026, 7, 13, 10, 0, 0, 0, time.UTC)
	activeTaskID := createVMActivityTask(t, client, userID, "vm-active", consts.TaskStatusProcessing, old)
	finishedTaskID := createVMActivityTask(t, client, userID, "vm-active", consts.TaskStatusFinished, old)
	otherTaskID := createVMActivityTask(t, client, userID, "vm-other", consts.TaskStatusProcessing, old)

	repo := &TaskRepo{db: client}
	activityAt := old.Add(10 * time.Minute)
	if err := repo.RefreshLastActiveAtByVMID(ctx, "vm-active", activityAt, 5*time.Minute); err != nil {
		t.Fatal(err)
	}

	assertTaskLastActiveAt(t, client, activeTaskID, activityAt)
	assertTaskLastActiveAt(t, client, finishedTaskID, old)
	assertTaskLastActiveAt(t, client, otherTaskID, old)

	if err := repo.RefreshLastActiveAtByVMID(ctx, "vm-active", activityAt.Add(2*time.Minute), 5*time.Minute); err != nil {
		t.Fatal(err)
	}
	assertTaskLastActiveAt(t, client, activeTaskID, activityAt)

	if err := repo.RefreshLastActiveAtByVMID(ctx, "vm-active", old, 0); err != nil {
		t.Fatal(err)
	}
	assertTaskLastActiveAt(t, client, activeTaskID, activityAt)
}

func createVMActivityTask(t *testing.T, client *db.Client, userID uuid.UUID, vmID string, status consts.TaskStatus, lastActiveAt time.Time) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	taskID := uuid.New()
	if _, err := client.Task.Create().
		SetID(taskID).
		SetUserID(userID).
		SetKind(consts.TaskTypeDevelop).
		SetContent("content").
		SetStatus(status).
		SetCreatedAt(lastActiveAt.Add(-time.Hour)).
		SetLastActiveAt(lastActiveAt).
		Save(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TaskVirtualMachine.Create().SetID(uuid.New()).SetTaskID(taskID).SetVirtualmachineID(vmID).Save(ctx); err != nil {
		t.Fatal(err)
	}
	return taskID
}

func assertTaskLastActiveAt(t *testing.T, client *db.Client, taskID uuid.UUID, want time.Time) {
	t.Helper()
	task, err := client.Task.Get(context.Background(), taskID)
	if err != nil {
		t.Fatal(err)
	}
	if !task.LastActiveAt.Equal(want) {
		t.Fatalf("task %s last active at = %v, want %v", taskID, task.LastActiveAt, want)
	}
}
