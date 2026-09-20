package billing

import (
	"encoding/json"
	"testing"
	"time"
)

func TestScheduleCycle(t *testing.T) {
	for _, tc := range []struct {
		from, to, at, next string
	}{
		{"monthly", "daily", "2026-09-19T04:00:00Z", "2026-09-20T00:00:00+08:00"},
		{"monthly", "weekly", "2026-09-19T12:00:00+08:00", "2026-09-21T00:00:00+08:00"},
		{"daily", "monthly", "2026-09-19T12:00:00+08:00", "2026-10-01T00:00:00+08:00"},
		{"monthly", "daily", "2028-02-28T23:59:59+08:00", "2028-02-29T00:00:00+08:00"},
		{"daily", "monthly", "2028-02-29T00:00:00+08:00", "2028-03-01T00:00:00+08:00"},
		{"monthly", "daily", "2026-12-31T23:59:59+08:00", "2027-01-01T00:00:00+08:00"},
		{"daily", "weekly", "2026-12-31T00:00:00+08:00", "2027-01-04T00:00:00+08:00"},
		{"monthly", "weekly", "2026-09-21T00:00:00+08:00", "2026-09-28T00:00:00+08:00"},
	} {
		t.Run(tc.from+"_to_"+tc.to+"_"+tc.at, func(t *testing.T) {
			now, _ := time.Parse(time.RFC3339, tc.at)
			next, _ := time.Parse(time.RFC3339, tc.next)
			p := Policy{Cycle: tc.from}
			originalStart, _ := p.period(now)
			p.scheduleCycle(tc.to, now)
			for _, at := range []time.Time{now, next.Add(-time.Nanosecond)} {
				start, end := p.period(at)
				if !start.Equal(originalStart) || !end.Equal(next) {
					t.Fatalf("切换前周期错误：%s ~ %s", start, end)
				}
			}
			wantStart, wantEnd := (Policy{Cycle: tc.to}).period(next)
			start, end := p.period(next)
			if !start.Equal(wantStart) || !end.Equal(wantEnd) {
				t.Fatalf("切换后周期错误：%s ~ %s", start, end)
			}
			p.activateCycle(next)
			if p.Cycle != tc.to || p.PendingCycle != "" || p.CycleEffectiveAt != nil || p.TransitionStart != nil {
				t.Fatalf("生效后未清理切换状态：%+v", p)
			}
			start, end = p.period(next.AddDate(0, 2, 0))
			wantStart, wantEnd = (Policy{Cycle: tc.to}).period(next.AddDate(0, 2, 0))
			if !start.Equal(wantStart) || !end.Equal(wantEnd) {
				t.Fatalf("跨过多个周期后仍复用过渡周期：%s ~ %s", start, end)
			}
		})
	}
}

func TestRefreshCycleReschedule(t *testing.T) {
	for _, tc := range []struct {
		name, from, first, again, at, next string
		legacy, pending                    bool
	}{
		{"原周期重复保存", "monthly", "monthly", "monthly", "2026-09-19T13:00:00+08:00", "2026-10-01T00:00:00+08:00", false, false},
		{"取消待生效修改", "monthly", "daily", "monthly", "2026-09-19T13:00:00+08:00", "2026-10-01T00:00:00+08:00", false, false},
		{"延长周期后重复保存", "daily", "monthly", "monthly", "2026-09-22T13:00:00+08:00", "2026-10-01T00:00:00+08:00", false, true},
		{"跨旧边界后恢复每日", "daily", "monthly", "daily", "2026-09-22T13:00:00+08:00", "2026-09-23T00:00:00+08:00", false, true},
		{"再次修改待生效周期", "daily", "monthly", "weekly", "2026-09-22T13:00:00+08:00", "2026-09-28T00:00:00+08:00", false, true},
		{"重新保存旧版待生效配置", "monthly", "daily", "daily", "2026-09-19T13:00:00+08:00", "2026-09-20T00:00:00+08:00", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, user, _ := fixture(t)
			ctx := t.Context()
			now, _ := time.Parse(time.RFC3339, "2026-09-19T12:00:00+08:00")
			s.now = func() time.Time { return now }
			p := defaultPolicy()
			p.Cycle = tc.from
			if tc.legacy {
				_, end := p.period(now)
				p.PendingCycle, p.CycleEffectiveAt = tc.first, &end
			}
			setPolicy(t, s, p)
			before, err := s.Account(ctx, user)
			if err != nil {
				t.Fatal(err)
			}
			call := walletAdmin(t, s, user)
			save := func(cycle string) {
				t.Helper()
				policy, err := s.Policy(ctx)
				if err != nil {
					t.Fatal(err)
				}
				call("PATCH", "/billing/settings/cycle", map[string]any{"revision": policy.Revision, "quota_refresh_cycle": cycle}, 200)
			}
			if !tc.legacy {
				save(tc.first)
			}
			now, _ = time.Parse(time.RFC3339, tc.at)
			save(tc.again)
			p, err = s.Policy(ctx)
			if err != nil || (p.PendingCycle != "") != tc.pending {
				t.Fatalf("待生效状态错误：%+v %v", p, err)
			}
			next, _ := time.Parse(time.RFC3339, tc.next)
			after, err := s.Account(ctx, user)
			if err != nil || before.ID != after.ID || before.Balance != after.Balance || !after.End.Equal(next) {
				t.Fatalf("再次保存不应重发额度：before=%+v after=%+v err=%v", before, after, err)
			}
		})
	}
}

func TestRefreshCycleChange(t *testing.T) {
	for _, tc := range []struct {
		from, to, next string
	}{
		{"monthly", "daily", "2026-09-20T00:00:00+08:00"},
		{"monthly", "weekly", "2026-09-21T00:00:00+08:00"},
		{"weekly", "daily", "2026-09-20T00:00:00+08:00"},
		{"weekly", "monthly", "2026-10-01T00:00:00+08:00"},
		{"daily", "weekly", "2026-09-21T00:00:00+08:00"},
		{"daily", "monthly", "2026-10-01T00:00:00+08:00"},
	} {
		t.Run(tc.from+"_to_"+tc.to, func(t *testing.T) {
			s, user, model := fixture(t)
			ctx := t.Context()
			now, _ := time.Parse(time.RFC3339, "2026-09-19T12:00:00+08:00")
			s.now = func() time.Time { return now }
			p := defaultPolicy()
			p.Cycle, p.Enabled = tc.from, true
			setPolicy(t, s, p)
			reservation, err := s.Begin(ctx, Request{UserID: user, ResourceID: model, Category: "model"})
			if err != nil {
				t.Fatal(err)
			}
			before, err := s.Account(ctx, user)
			if err != nil {
				t.Fatal(err)
			}
			call := walletAdmin(t, s, user)
			var out struct {
				Policy Policy    `json:"policy"`
				Next   time.Time `json:"next_refresh_at"`
			}
			if err := json.Unmarshal(call("PATCH", "/billing/settings/cycle", map[string]any{"revision": 1, "quota_refresh_cycle": tc.to}, 200), &out); err != nil {
				t.Fatal(err)
			}
			next, _ := time.Parse(time.RFC3339, tc.next)
			if !out.Next.Equal(next) || out.Policy.CycleEffectiveAt == nil || !out.Policy.CycleEffectiveAt.Equal(next) {
				t.Fatalf("下次刷新应为新周期边界 %s，实际为 %+v", next, out)
			}
			checkCurrent := func() {
				t.Helper()
				if err := s.refresh(ctx); err != nil {
					t.Fatal(err)
				}
				a, err := s.Account(ctx, user)
				if err != nil || a.ID != before.ID || !a.Start.Equal(before.Start) || !a.End.Equal(next) || a.Balance != before.Balance || a.Frozen != before.Frozen || a.Quota != before.Quota {
					t.Fatalf("切换前不应重置账户或余额：before=%+v after=%+v err=%v", before, a, err)
				}
			}
			checkCurrent()
			now = next.Add(-time.Nanosecond)
			checkCurrent()
			now = next
			if err := s.refresh(ctx); err != nil {
				t.Fatal(err)
			}
			after, err := s.Account(ctx, user)
			_, end := (Policy{Cycle: tc.to}).period(now)
			if err != nil || after.ID == before.ID || !after.Start.Equal(next) || !after.End.Equal(end) || after.Balance != before.Quota || after.Frozen != 0 {
				t.Fatalf("切换时应创建完整新周期：%+v %v", after, err)
			}
			if err := s.Finish(ctx, reservation.ID, Usage{Known: true, Result: "cancelled"}); err != nil {
				t.Fatal(err)
			}
			again, err := s.Account(ctx, user)
			if err != nil || again != after {
				t.Fatalf("跨周期释放不应改变新账户：%+v %v", again, err)
			}
			var oldEnd time.Time
			if err := s.pool.QueryRow(ctx, `SELECT period_end_at FROM credit_accounts WHERE id=$1`, before.ID).Scan(&oldEnd); err != nil || !oldEnd.Equal(next) {
				t.Fatalf("历史账户到期时间未同步：%s %v", oldEnd, err)
			}
			var grants int
			if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM credit_ledger_entries WHERE account_id=$1 AND entry_type='grant'`, after.ID).Scan(&grants); err != nil || grants != 1 {
				t.Fatalf("新周期应仅发放一次：%d %v", grants, err)
			}
		})
	}
}
