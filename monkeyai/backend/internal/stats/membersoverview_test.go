package stats

import (
	"fmt"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

const membersOverviewPath = "/statistics/session-reporting/members/overview"

func TestMembersOverviewRejectsQueries(t *testing.T) {
	for _, query := range []string{"range=7d", "timezone=UTC", "limit=20", "unknown="} {
		t.Run(query, func(t *testing.T) {
			request(t, &Service{}, membersOverviewPath+"?"+query, 400)
		})
	}
}

func TestMembersOverviewEmptyUsage(t *testing.T) {
	s, user, _ := fixture(t)
	exec(t, s, `UPDATE users SET created_at=$1 WHERE id=$2`, s.now().AddDate(0, 0, -100), user)
	for _, deleted := range []bool{false, true} {
		if deleted {
			exec(t, s, `UPDATE users SET deleted_at=$1 WHERE id=$2`, s.now(), user)
		}
		out := request(t, s, membersOverviewPath, 200)
		wantTotal := float64(1)
		if deleted {
			wantTotal = 0
		}
		number(t, out, "total_members", wantTotal)
		for _, period := range []string{"last_7d", "previous_7d", "last_24h", "previous_24h"} {
			number(t, out[period].(map[string]any), "active_members", 0)
		}
		days := out["days"].([]any)
		if len(days) != 90 {
			t.Fatalf("空数据也应补齐 90 天: %v", out)
		}
		for _, raw := range days {
			row := raw.(map[string]any)
			number(t, row, "new_members", 0)
			number(t, row, "active_members", 0)
		}
	}
}

func TestMembersOverviewDistinctMembers(t *testing.T) {
	s, admin, _ := fixture(t)
	now := s.now()
	exec(t, s, `UPDATE users SET created_at=$1 WHERE id=$2`, now.AddDate(0, 0, -100), admin)
	newMember, disabled, idle, deleted := resource.ID(), resource.ID(), resource.ID(), resource.ID()
	for i, member := range []struct {
		id, status string
		createdAt  time.Time
		deletedAt  any
	}{
		{newMember, "active", now.Add(-time.Hour), nil},
		{disabled, "disabled", now.Add(-25 * time.Hour), nil},
		{idle, "active", now.AddDate(0, 0, -30), nil},
		{deleted, "active", now.Add(-time.Hour), now},
	} {
		exec(t, s, `INSERT INTO users(id,name,email,status,created_at,deleted_at) VALUES($1,'成员',$2,$3,$4,$5)`, member.id, fmt.Sprintf("member-%d@example.test", i), member.status, member.createdAt, member.deletedAt)
	}
	for _, sample := range []struct {
		owner string
		times []time.Time
	}{
		{admin, []time.Time{now.Add(-time.Hour), now.Add(-2 * time.Hour), now.Add(-25 * time.Hour), now.AddDate(0, 0, -8), now.AddDate(0, 0, -9)}},
		{admin, []time.Time{now.Add(-3 * time.Hour)}},
		{newMember, []time.Time{now.Add(-30 * time.Minute), now.Add(-20 * time.Minute)}},
		{disabled, []time.Time{now.Add(-25 * time.Hour)}},
		{deleted, []time.Time{now.Add(-time.Hour)}},
	} {
		session := resource.ID()
		conversationSession(t, s, sample.owner, session, "成员统计", now.AddDate(0, 0, -20))
		for i, at := range sample.times {
			conversationTurn(t, s, session, i+1, at, "complete", nil, 0, 0)
		}
	}
	// A login or a task with no reported turn is not usage.
	exec(t, s, `UPDATE users SET last_login_at=$1 WHERE id=$2`, now.Add(-time.Minute), idle)
	conversationSession(t, s, idle, resource.ID(), "只有任务没有轮次", now.Add(-time.Minute))
	out := request(t, s, membersOverviewPath, 200)
	number(t, out, "total_members", 4)
	for period, want := range map[string]float64{"last_7d": 3, "previous_7d": 1, "last_24h": 2, "previous_24h": 2} {
		number(t, out[period].(map[string]any), "active_members", want)
	}
	if out["timezone"] != "Asia/Shanghai" {
		t.Fatalf("时区错误: %v", out)
	}
	generated, err := time.Parse(time.RFC3339Nano, out["generated_at"].(string))
	if err != nil || !generated.Equal(now) {
		t.Fatalf("统计截止时间错误: %v (%v)", out["generated_at"], err)
	}
	days := out["days"].([]any)
	if len(days) != 90 {
		t.Fatalf("应返回 90 天: %d", len(days))
	}
	for i, raw := range days {
		row := raw.(map[string]any)
		if want := now.AddDate(0, 0, i-89).Format(time.DateOnly); row["date"] != want {
			t.Fatalf("日期不连续: got=%v want=%s", row["date"], want)
		}
		newCount, activeCount := float64(0), float64(0)
		switch i {
		case 59:
			newCount = 1
		case 80, 81:
			activeCount = 1
		case 88, 89:
			newCount, activeCount = 1, 2
		}
		number(t, row, "new_members", newCount)
		number(t, row, "active_members", activeCount)
	}
	// Deleting a member removes them consistently from totals, both windows and trends.
	exec(t, s, `UPDATE users SET deleted_at=$1 WHERE id=$2`, now, newMember)
	out = request(t, s, membersOverviewPath, 200)
	number(t, out, "total_members", 3)
	number(t, out["last_7d"].(map[string]any), "active_members", 2)
	number(t, out["last_24h"].(map[string]any), "active_members", 1)
	today := out["days"].([]any)[89].(map[string]any)
	number(t, today, "new_members", 0)
	number(t, today, "active_members", 1)
}

func TestMembersOverviewRollingBoundaries(t *testing.T) {
	s, admin, _ := fixture(t)
	now := s.now()
	exec(t, s, `UPDATE users SET created_at=$1 WHERE id=$2`, now.AddDate(0, 0, -100), admin)
	for i, offset := range []time.Duration{
		-336*time.Hour - time.Microsecond,
		-336 * time.Hour,
		-168*time.Hour - time.Microsecond,
		-168 * time.Hour,
		-48*time.Hour - time.Microsecond,
		-48 * time.Hour,
		-24*time.Hour - time.Microsecond,
		-24 * time.Hour,
		-time.Microsecond,
		0,
		time.Hour,
	} {
		user, session := resource.ID(), resource.ID()
		exec(t, s, `INSERT INTO users(id,name,email,created_at) VALUES($1,'边界成员',$2,$3)`, user, fmt.Sprintf("member-boundary-%d@example.test", i), now.AddDate(0, 0, -100))
		at := now.Add(offset)
		conversationSession(t, s, user, session, "成员窗口边界", at)
		conversationTurn(t, s, session, 1, at, "complete", nil, 0, 0)
	}
	out := request(t, s, membersOverviewPath, 200)
	for period, want := range map[string]float64{"last_7d": 6, "previous_7d": 2, "last_24h": 2, "previous_24h": 2} {
		number(t, out[period].(map[string]any), "active_members", want)
	}
	// Records at or after generated_at must not leak into today's chart either.
	number(t, out["days"].([]any)[89].(map[string]any), "active_members", 1)
}

func TestMembersOverviewSevenDaysAre168Hours(t *testing.T) {
	s, admin, _ := fixture(t)
	// The database session timezone crosses daylight saving, while the API uses rolling hours.
	cfg := s.pool.Config()
	cfg.ConnConfig.RuntimeParams["timezone"] = "America/New_York"
	pool, err := pgxpool.NewWithConfig(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	s.pool = pool
	now := time.Date(2026, 11, 3, 17, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	exec(t, s, `UPDATE users SET created_at=$1 WHERE id=$2`, now.AddDate(0, 0, -100), admin)
	for i, offset := range []time.Duration{-168 * time.Hour, -168*time.Hour - 30*time.Minute, -336*time.Hour - 30*time.Minute} {
		user, session := resource.ID(), resource.ID()
		exec(t, s, `INSERT INTO users(id,name,email,created_at) VALUES($1,'夏令时边界成员',$2,$3)`, user, fmt.Sprintf("member-dst-%d@example.test", i), now.AddDate(0, 0, -100))
		at := now.Add(offset)
		conversationSession(t, s, user, session, "跨夏令时窗口", at)
		conversationTurn(t, s, session, 1, at, "complete", nil, 0, 0)
	}
	out := request(t, s, membersOverviewPath, 200)
	number(t, out["last_7d"].(map[string]any), "active_members", 1)
	number(t, out["previous_7d"].(map[string]any), "active_members", 1)
}
