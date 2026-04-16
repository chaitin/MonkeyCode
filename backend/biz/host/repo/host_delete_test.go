package repo

import (
	"context"
	"testing"

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
