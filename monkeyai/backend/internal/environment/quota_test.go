package environment

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestQuotaCountsStoppedUntilDeletionConfirmed(t *testing.T) {
	s, user, host := fixture(t)
	ctx := t.Context()
	check := func(want int64) {
		t.Helper()
		out, err := s.Quota(ctx, user, host)
		if err != nil || out.Usage.Environments != want || out.Remaining.Environments != max(0, out.Limits.Environments-want) {
			t.Fatal(out, err, want)
		}
	}
	check(0)
	e, err := s.Create(ctx, user, Creation{"quota", "quota-create"})
	if err != nil {
		t.Fatal(err)
	}
	check(1)
	stop, err := s.Change(ctx, &user, e.Environment.ID, "stopped", Change{1, "quota-stop"})
	if err != nil {
		t.Fatal(err)
	}
	check(1)
	syncState(t, s, host, observe(stop.Environment, "stopped"))
	check(1)
	deleted, err := s.Change(ctx, &user, e.Environment.ID, "deleted", Change{2, "quota-delete"})
	if err != nil {
		t.Fatal(err)
	}
	check(1)
	syncState(t, s, host, observe(deleted.Environment, "deleted"))
	check(0)
	other := resource.ID()
	if _, err := s.pool.Exec(ctx, "INSERT INTO users(id,name,email) VALUES($1::uuid,'test',$1::text || '@example.com')", other); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlc.New(s.pool).SetQuota(ctx, sqlc.SetQuotaParams{UserID: other, HostID: host, MaxEnvironments: 1}); err != nil {
		t.Fatal(err)
	}
	out, err := s.Quota(ctx, other, host)
	if err != nil || out.Limits.Environments != 1 || out.Usage.Environments != 0 {
		t.Fatal(out, err)
	}
	if _, err := s.pool.Exec(ctx, "UPDATE users SET status='disabled' WHERE id=$1", other); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Quota(ctx, other, host); err == nil {
		t.Fatal("停用用户仍取得配额")
	}
}
func TestResourcesWithoutDiskConfiguration(t *testing.T) {
	s, user, _ := fixture(t)
	if _, err := s.Create(t.Context(), user, Creation{"directory", "no-disk"}); err != nil {
		t.Fatal(err)
	}
}
