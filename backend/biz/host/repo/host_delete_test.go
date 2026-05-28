package repo

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/enttest"
	"github.com/chaitin/MonkeyCode/backend/db/virtualmachine"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

func TestHostRepo_DeleteVirtualMachineMarksRecycledBeforeSoftDelete(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:host-delete-test?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	repo := &HostRepo{db: client}
	uid := uuid.New()

	if _, err := client.User.Create().
		SetID(uid).
		SetName("tester").
		SetRole(consts.UserRoleIndividual).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatalf("create user: %v", err)
	}

	hostID := "host-1"
	if _, err := client.Host.Create().
		SetID(hostID).
		SetUserID(uid).
		SetHostname("host").
		Save(ctx); err != nil {
		t.Fatalf("create host: %v", err)
	}

	vmID := "vm-1"
	if _, err := client.VirtualMachine.Create().
		SetID(vmID).
		SetHostID(hostID).
		SetUserID(uid).
		SetName("vm").
		Save(ctx); err != nil {
		t.Fatalf("create vm: %v", err)
	}

	callbackCalled := false
	if err := repo.DeleteVirtualMachine(ctx, uid, hostID, vmID, func(vm *db.VirtualMachine) error {
		callbackCalled = true
		if vm.ID != vmID {
			t.Fatalf("unexpected vm id in callback: %s", vm.ID)
		}
		return nil
	}); err != nil {
		t.Fatalf("delete virtual machine: %v", err)
	}

	if !callbackCalled {
		t.Fatal("expected delete callback to be called")
	}

	deletedVM, err := client.VirtualMachine.Query().
		Where(virtualmachine.ID(vmID)).
		Only(entx.SkipSoftDelete(ctx))
	if err != nil {
		t.Fatalf("query deleted vm: %v", err)
	}

	if !deletedVM.IsRecycled {
		t.Fatal("expected deleted vm to be marked recycled")
	}

	if deletedVM.DeletedAt.IsZero() {
		t.Fatal("expected deleted vm to have deleted_at set")
	}
}

func TestHostRepo_CountDownQueriesUseExpiredAt(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:host-expired-at-test?mode=memory&cache=shared&_fk=1")
	defer client.Close()

	repo := &HostRepo{db: client}
	uid := uuid.New()
	now := time.Now()

	if _, err := client.User.Create().
		SetID(uid).
		SetName("tester").
		SetRole(consts.UserRoleIndividual).
		SetStatus(consts.UserStatusActive).
		Save(ctx); err != nil {
		t.Fatalf("create user: %v", err)
	}

	hostID := "host-1"
	if _, err := client.Host.Create().
		SetID(hostID).
		SetUserID(uid).
		SetHostname("host").
		Save(ctx); err != nil {
		t.Fatalf("create host: %v", err)
	}

	createVM := func(id string, expiredAt *time.Time, recycled bool) {
		crt := client.VirtualMachine.Create().
			SetID(id).
			SetHostID(hostID).
			SetUserID(uid).
			SetName(id).
			SetIsRecycled(recycled)
		if expiredAt != nil {
			crt.SetExpiredAt(*expiredAt)
		}
		if _, err := crt.Save(ctx); err != nil {
			t.Fatalf("create vm %s: %v", id, err)
		}
	}

	recentExpiry := now.Add(30 * time.Minute)
	oldExpiry := now.Add(-25 * time.Hour)
	createVM("vm-expiring", &recentExpiry, false)
	createVM("vm-forever", nil, false)
	createVM("vm-old", &oldExpiry, false)
	createVM("vm-recycled", &recentExpiry, true)

	pastHour, err := repo.PastHourVirtualMachine(ctx)
	if err != nil {
		t.Fatalf("past hour virtual machines: %v", err)
	}
	if len(pastHour) != 1 || pastHour[0].ID != "vm-expiring" {
		t.Fatalf("past hour ids = %v, want only vm-expiring", vmIDs(pastHour))
	}

	allCountdown, err := repo.AllCountDownVirtualMachine(ctx)
	if err != nil {
		t.Fatalf("all countdown virtual machines: %v", err)
	}
	if len(allCountdown) != 2 {
		t.Fatalf("all countdown ids = %v, want vm-expiring and vm-old", vmIDs(allCountdown))
	}
}

func vmIDs(vms []*db.VirtualMachine) []string {
	ids := make([]string, 0, len(vms))
	for _, vm := range vms {
		ids = append(ids, vm.ID)
	}
	return ids
}
