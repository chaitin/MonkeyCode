package environment

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
)

func TestOfflineDeletionArchive(t *testing.T) {
	s, user, host := fixture(t)
	ctx := t.Context()
	credits := billing.NewService(s.pool)
	if _, err := s.pool.Exec(ctx, "UPDATE users SET role='admin' WHERE id=$1", user); err != nil {
		t.Fatal(err)
	}
	if err := credits.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	s.WithBilling(credits)
	q := sqlc.New(s.pool)
	created, err := s.Create(ctx, user, Creation{testSpecification(), "离线删除", "create-offline"})
	if err != nil {
		t.Fatal(err)
	}
	change := Change{created.Environment.Generation, "delete-offline"}
	removed, err := s.Change(ctx, &user, created.Environment.ID, "deleted", change)
	if err != nil {
		t.Fatal(err)
	}
	scan := func() {
		t.Helper()
		if err := q.ArchiveOfflineDeletions(ctx); err != nil {
			t.Fatal(err)
		}
	}
	list := func(status string, admin bool) []sqlc.Environment {
		t.Helper()
		rows, err := q.ListEnvironments(ctx, sqlc.ListEnvironmentsParams{UserID: &user, IncludeDeleted: admin, Status: status, Sort: "newest", Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}
	scan()
	if rows := list("pending_deleted", true); len(rows) != 1 || rows[0].ArchivedAt != nil {
		t.Fatal("在线删除不应归档", rows)
	}
	if _, err := s.pool.Exec(ctx, "UPDATE hosts SET last_seen_at=now()-interval '2 minutes' WHERE id=$1", host); err != nil {
		t.Fatal(err)
	}
	scan()
	if len(list("active", true)) != 0 || len(list("all", false)) != 0 {
		t.Fatal("离线待删环境仍在使用列表")
	}
	rows := list("deleted", true)
	if len(rows) != 1 || rows[0].ArchivedAt == nil || rows[0].DeletedAt != nil {
		t.Fatal("离线归档不应伪造删除确认", rows)
	}
	replay, err := s.Change(ctx, &user, created.Environment.ID, "deleted", change)
	if err != nil || replay.Operation.ID != removed.Operation.ID || replay.Operation.Status != "pending" {
		t.Fatal(replay, err)
	}
	if cmds := syncState(t, s, host, observe(created.Environment, "running")); len(cmds.Targets) != 1 {
		t.Fatal("重连后仍需下发删除指令", cmds)
	}
	failed := observe(removed.Environment, "failed")
	failed.Reason = "apply_failed"
	syncState(t, s, host, failed)
	scan()
	if rows := list("failed", true); len(rows) != 1 || rows[0].ArchivedAt != nil {
		t.Fatal("清理失败应可见并允许重试", rows)
	}
	retry, err := s.Change(ctx, &user, created.Environment.ID, "deleted", Change{removed.Environment.Generation, "retry-offline"})
	if err != nil {
		t.Fatal(err)
	}
	scan()
	if cmds := syncState(t, s, host, observe(retry.Environment, "deleted")); len(cmds.Targets) != 0 {
		t.Fatal("已确认的清理指令不应重复下发", cmds)
	}
	rows = list("deleted", true)
	if len(rows) != 1 || rows[0].DeletedAt == nil || rows[0].ArchivedAt != nil {
		t.Fatal("宿主确认后应完成删除", rows)
	}
}
