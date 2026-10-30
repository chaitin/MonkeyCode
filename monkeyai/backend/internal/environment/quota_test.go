package environment

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestQuotaTracksReservationsAndRetainedStorage(t *testing.T) {
	s, user, host, preset := fixture(t)
	ctx := t.Context()
	check := func(want Budget) {
		t.Helper()
		out, err := s.Quota(ctx, user)
		if err != nil || out.Usage != want {
			t.Fatalf("额度占用不符：%+v，%v，预期 %+v", out, err, want)
		}
		if out.Remaining.CPUMillis != out.Limits.CPUMillis-want.CPUMillis || out.Remaining.StorageBytes != out.Limits.StorageBytes-want.StorageBytes {
			t.Fatal("剩余额度不符", out)
		}
	}
	check(Budget{})
	created, err := s.Create(ctx, user, Creation{preset, "项目", "quota-create"})
	if err != nil {
		t.Fatal(err)
	}
	used := Budget{1, 1, 1000, 512 << 20, 3 << 30}
	check(used)
	stopped, err := s.Change(ctx, &user, created.Environment.ID, "stopped", Change{1, "quota-stop"})
	if err != nil {
		t.Fatal(err)
	}
	check(used)
	syncState(t, s, host, observe(stopped.Environment, "stopped"))
	check(Budget{Environments: 1, StorageBytes: 3 << 30})
	deleted, err := s.Change(ctx, &user, created.Environment.ID, "deleted", Change{2, "quota-delete"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(deleted.Environment, "deleted"))
	check(Budget{StorageBytes: 3 << 30})
	other := resource.ID()
	if _, err := s.pool.Exec(ctx, "INSERT INTO users(id) VALUES($1)", other); err != nil {
		t.Fatal(err)
	}
	out, err := s.Quota(ctx, other)
	if err != nil || out.Usage != (Budget{}) || out.Remaining != out.Limits {
		t.Fatal("其他用户额度受影响", out, err)
	}
	if _, err := sqlc.New(s.pool).SetQuota(ctx, sqlc.SetQuotaParams{UserID: other, MaxEnvironments: 1, MaxRunning: 1, CpuMillis: 2000, MemoryBytes: 2 << 30, StorageBytes: 5 << 30}); err != nil {
		t.Fatal(err)
	}
	out, err = s.Quota(ctx, other)
	if err != nil || out.Limits != (Budget{1, 1, 2000, 2 << 30, 5 << 30}) || out.Remaining != out.Limits {
		t.Fatal("未使用用户覆盖额度", out, err)
	}
	if _, err := s.pool.Exec(ctx, "UPDATE users SET status='disabled' WHERE id=$1", other); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Quota(ctx, other); err == nil {
		t.Fatal("接受已停用用户")
	}
}
