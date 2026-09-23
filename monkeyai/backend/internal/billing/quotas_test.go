package billing

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/group"
	groupsqlc "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/group/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestQuotaGroupsMatchMemberGroups(t *testing.T) {
	s, user, _ := fixture(t)
	ctx := t.Context()
	first, second, child, deleted := resource.ID(), resource.ID(), resource.ID(), resource.ID()
	// 创建顺序与名称排序相反；相同创建时间仍须使用 ID 稳定排序。
	if _, err := s.pool.Exec(ctx, `INSERT INTO groups(id,parent_id,name,created_at,deleted_at) VALUES
		($1,NULL,'Z 外部测试用户','2026-09-01',NULL),
		($2,NULL,'A 内部成员','2026-09-02',NULL),
		($3,$1,'子分组','2026-09-02',NULL),
		($4,NULL,'已删除分组','2026-09-03',now())`, first, second, child, deleted); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO billing_quotas(subject_type,group_id,credits_per_cycle,updated_by_user_id) VALUES('group',$1,50000,$2)`, first, user); err != nil {
		t.Fatal(err)
	}
	check := func(t *testing.T) {
		t.Helper()
		members, err := groupsqlc.New(s.pool).ListGroups(ctx)
		if err != nil {
			t.Fatal(err)
		}
		quotas, err := resource.DecodeObjects(sqlc.New(s.pool).ListGroupQuotas(ctx))
		if err != nil {
			t.Fatal(err)
		}
		if len(members) != 3 || len(quotas) != len(members) {
			t.Fatalf("分组数量不一致: members=%d quotas=%d", len(members), len(quotas))
		}
		for i, member := range members {
			parent := rootGroup
			if member.ParentID != nil {
				parent = *member.ParentID
			}
			quota := quotas[i]
			if quota.String("id") != member.ID || quota.String("name") != member.Name || quota.String("parent_id") != parent {
				t.Fatalf("第 %d 个分组顺序或层级不一致: member=%+v quota=%v", i, member, quota)
			}
			if member.ID == first {
				credits, err := ParseAmount(quota.String("credits"))
				if err != nil || credits != amountText("50000") {
					t.Fatalf("分组自定义额度被改变: %v", quota)
				}
			} else if quota["credits"] != nil {
				t.Fatalf("未配置的分组应继承额度: %v", quota)
			}
		}
	}
	t.Run("初始顺序与层级", check)
	if _, err := s.pool.Exec(ctx, `UPDATE groups SET name='0 内部成员' WHERE id=$1`, second); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE groups SET parent_id=$2 WHERE id=$1`, child, second); err != nil {
		t.Fatal(err)
	}
	t.Run("重命名与移动后仍一致", check)
}

func TestQuotaMembershipInheritance(t *testing.T) {
	s, user, _ := fixture(t)
	ctx := t.Context()
	policy, err := s.Policy(ctx)
	if err != nil {
		t.Fatal(err)
	}
	periodStart, _ := policy.period(s.now())
	parent, child, other := resource.ID(), resource.ID(), resource.ID()
	exec := func(statement string, args ...any) {
		t.Helper()
		if _, err := s.pool.Exec(ctx, statement, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO groups(id,parent_id,name,created_at) VALUES
		($1,NULL,'上级','2026-09-01'),($2,$1,'子组','2026-09-02'),($3,NULL,'另一组','2026-09-03')`, parent, child, other)
	exec(`INSERT INTO billing_quotas(subject_type,group_id,credits_per_cycle,updated_by_user_id) VALUES
		('group',$1,50000,$3),('group',$2,80000,$3)`, parent, other, user)
	check := func(name, credits, source, groupID string, members ...string) {
		t.Helper()
		t.Run(name, func(t *testing.T) {
			actual, group, inherited, err := effectiveQuota(ctx, s.pool, user)
			if err != nil || actual != amountText(credits) || group != groupID || inherited != source {
				t.Fatalf("实际发放额度不符: credits=%s group=%s source=%s err=%v", actual, group, inherited, err)
			}
			users, err := resource.DecodeObjects(sqlc.New(s.pool).ListUserQuotas(ctx, sqlc.ListUserQuotasParams{RootGroup: rootGroup, RootCredits: "10000", PeriodStartAt: periodStart}))
			if err != nil || len(users) != 1 {
				t.Fatalf("读取额度列表: %v %v", users, err)
			}
			listed := users[0]
			if _, ok := listed["credits"]; ok {
				t.Fatalf("成员不应返回个人额度字段: %v", listed)
			}
			if amountText(listed.String("effective_credits")) != actual || amountText(listed.String("balance_credits")) != actual || amountText(listed.String("available_credits")) != actual || listed.String("inherited_from") != source {
				t.Fatalf("费用页与实际发放不一致: %v", listed)
			}
			ids := []string{}
			for _, id := range listed["group_ids"].([]any) {
				ids = append(ids, id.(string))
			}
			if !slices.Equal(ids, members) {
				t.Fatalf("费用页成员归属不一致: got=%v want=%v", ids, members)
			}
		})
	}
	check("无分组继承团队", "10000", rootGroup, "")
	exec(`INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$2)`, child, user)
	check("单组继承最近上级", "50000", parent, child, child)
	exec(`INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$2)`, other, user)
	check("多组取最高而非叠加", "80000", other, other, child, other)
	exec(`INSERT INTO billing_quotas(subject_type,user_id,credits_per_cycle,updated_by_user_id) VALUES('user',$1,0,$1)`, user)
	check("个人历史额度不参与计算", "80000", other, other, child, other)
	exec(`UPDATE billing_quotas SET credits_per_cycle=123 WHERE user_id=$1`, user)
	check("个人历史额度变化仍不参与计算", "80000", other, other, child, other)
	exec(`UPDATE billing_quotas SET credits_per_cycle=50000 WHERE group_id=$1`, other)
	check("同额度稳定选取较早分组", "50000", parent, child, child, other)
	exec(`UPDATE group_users SET removed_at=now() WHERE group_id=$1`, other)
	check("移出分组立即更新继承", "50000", parent, child, child)
	exec(`INSERT INTO billing_quotas(subject_type,group_id,credits_per_cycle,updated_by_user_id) VALUES('group',$1,0,$2)`, child, user)
	check("子组零额度覆盖上级而非取祖先最大值", "0", child, child, child)
	exec(`UPDATE billing_quotas SET deleted_at=now() WHERE group_id=$1`, child)
	exec(`UPDATE groups SET parent_id=$2 WHERE id=$1`, child, other)
	check("移动分组跟随新上级", "50000", other, child, child)
	exec(`UPDATE billing_quotas SET deleted_at=now() WHERE group_id=$1`, other)
	check("整条分支未配置则继承团队", "10000", rootGroup, child, child)
	exec(`INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$2)`, parent, user)
	exec(`UPDATE billing_quotas SET credits_per_cycle=10 WHERE group_id=$1`, parent)
	check("多组比较包含分支继承的团队默认值", "10000", rootGroup, child, parent, child)
	exec(`UPDATE groups SET deleted_at=now() WHERE id=$1`, child)
	check("已删除分组不参与继承", "10", parent, parent, parent)
	exec(`UPDATE group_users SET removed_at=now() WHERE group_id=$1`, parent)
	check("移出全部分组恢复团队", "10000", rootGroup, "")
}

func TestUserQuotaChangesAreRejected(t *testing.T) {
	s, user, _ := fixture(t)
	call := walletAdmin(t, s, user)
	call("PUT", "/billing/quotas", map[string]any{
		"revision": 1,
		"changes": []map[string]any{{
			"subject_type": "user",
			"id":           user,
			"credits":      "123",
		}},
	}, 422)

	var count int
	if err := s.pool.QueryRow(t.Context(), `SELECT count(*) FROM billing_quotas WHERE user_id=$1 AND deleted_at IS NULL`, user).Scan(&count); err != nil || count != 0 {
		t.Fatalf("个人额度不应写入: count=%d err=%v", count, err)
	}
}

func TestGroupQuotaChangesRequireIntegers(t *testing.T) {
	s, admin, _ := fixture(t)
	call := walletAdmin(t, s, admin)
	call("PUT", "/billing/quotas", map[string]any{
		"revision": 1,
		"changes": []map[string]any{{
			"subject_type": "group",
			"id":           rootGroup,
			"credits":      "123.5",
		}},
	}, 422)

	policy, err := s.Policy(t.Context())
	if err != nil || policy.RootCredits != amountText("10000") {
		t.Fatalf("小数额度不应写入: policy=%+v err=%v", policy, err)
	}
}

func TestImmediateQuotaReset(t *testing.T) {
	s, admin, _ := fixture(t)
	ctx := t.Context()
	parent, child, other := resource.ID(), resource.ID(), resource.ID()
	explicit, unselected := resource.ID(), resource.ID()
	if _, err := s.pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES
		($1,'显式成员','explicit@example.com','user'),($2,'未选成员','unselected@example.com','user')`, explicit, unselected); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO groups(id,parent_id,name) VALUES
		($1,NULL,'父组'),($2,$1,'子组'),($3,NULL,'其他组')`, parent, child, other); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES
		($1,$2,$2),($3,$4,$2)`, child, admin, other, unselected); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO billing_quotas(subject_type,group_id,credits_per_cycle,updated_by_user_id) VALUES('group',$1,500,$2)`, parent, admin); err != nil {
		t.Fatal(err)
	}
	adminAccount, err := s.Account(ctx, admin)
	if err != nil {
		t.Fatal(err)
	}
	explicitAccount, err := s.Account(ctx, explicit)
	if err != nil {
		t.Fatal(err)
	}
	unselectedAccount, err := s.Account(ctx, unselected)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.pool.Exec(ctx, `UPDATE credit_accounts SET balance=CASE id WHEN $1 THEN 100 WHEN $2 THEN 3 WHEN $3 THEN 2 END,
		frozen=CASE WHEN id=$1 THEN 20 ELSE 0 END WHERE id IN ($1,$2,$3)`,
		adminAccount.ID, explicitAccount.ID, unselectedAccount.ID); err != nil {
		t.Fatal(err)
	}
	call := walletAdmin(t, s, admin)
	key := resource.ID()
	input := map[string]any{"group_ids": []string{parent}, "user_ids": []string{explicit}, "idempotency_key": key}
	var result struct {
		Count int `json:"reset_count"`
	}
	if err = json.Unmarshal(call("POST", "/billing/quotas/reset", input, 200), &result); err != nil || result.Count != 2 {
		t.Fatalf("立即重置响应错误: %+v %v", result, err)
	}
	resetAdmin, err := s.Account(ctx, admin)
	if err != nil || resetAdmin.Balance != amountText("500") || resetAdmin.Quota != amountText("500") || resetAdmin.Frozen != amountText("20") || resetAdmin.Available != amountText("480") || resetAdmin.GroupID != child {
		t.Fatalf("后代分组成员重置错误: %+v %v", resetAdmin, err)
	}
	resetExplicit, err := s.Account(ctx, explicit)
	if err != nil || resetExplicit.Balance != amountText("10000") || resetExplicit.Quota != amountText("10000") {
		t.Fatalf("显式成员重置错误: %+v %v", resetExplicit, err)
	}
	stillUnselected, err := s.Account(ctx, unselected)
	if err != nil || stillUnselected.Balance != amountText("2") {
		t.Fatalf("未选成员不应被重置: %+v %v", stillUnselected, err)
	}
	var resets int
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM credit_ledger_entries WHERE entry_type='reset'`).Scan(&resets); err != nil || resets != 2 {
		t.Fatalf("重置流水数量错误: %d %v", resets, err)
	}
	if err = json.Unmarshal(call("POST", "/billing/quotas/reset", input, 200), &result); err != nil || result.Count != 2 {
		t.Fatalf("幂等重放响应错误: %+v %v", result, err)
	}
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM credit_ledger_entries WHERE entry_type='reset'`).Scan(&resets); err != nil || resets != 2 {
		t.Fatalf("幂等重放产生了重复流水: %d %v", resets, err)
	}
	call("POST", "/billing/quotas/reset", map[string]any{"group_ids": []string{}, "user_ids": []string{unselected}, "idempotency_key": key}, 409)

	rootResult := struct {
		Count int `json:"reset_count"`
	}{}
	if err = json.Unmarshal(call("POST", "/billing/quotas/reset", map[string]any{"group_ids": []string{rootGroup}, "user_ids": []string{}, "idempotency_key": resource.ID()}, 200), &rootResult); err != nil || rootResult.Count != 3 {
		t.Fatalf("根分组应重置全部成员: %+v %v", rootResult, err)
	}
	resetUnselected, err := s.Account(ctx, unselected)
	if err != nil || resetUnselected.Balance != amountText("10000") {
		t.Fatalf("根分组未重置成员: %+v %v", resetUnselected, err)
	}
}

func TestQuotaMigrationPreservesAccounts(t *testing.T) {
	s, user, _ := fixture(t)
	ctx := t.Context()
	legacy, member := resource.ID(), resource.ID()
	exec := func(statement string, args ...any) {
		t.Helper()
		if _, err := s.pool.Exec(ctx, statement, args...); err != nil {
			t.Fatal(err)
		}
	}
	migration := func(direction string) {
		t.Helper()
		data, err := os.ReadFile("../../migrations/000003_group_quota_inheritance." + direction + ".sql")
		if err != nil {
			t.Fatal(err)
		}
		exec(string(data))
	}
	migration("down")
	exec(`INSERT INTO groups(id,name) VALUES($1,'旧归属'),($2,'成员分组')`, legacy, member)
	exec(`INSERT INTO billing_quotas(subject_type,group_id,credits_per_cycle,updated_by_user_id) VALUES('group',$1,90000,$3),('group',$2,50000,$3)`, legacy, member, user)
	exec(`UPDATE users SET billing_group_id=$2 WHERE id=$1`, user, legacy)
	exec(`INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$2)`, legacy, user)
	before, err := s.Account(ctx, user)
	if err != nil || before.Quota != amountText("90000") || before.GroupID != legacy {
		t.Fatal(before, err)
	}
	// 模拟升级前，成员分组与旧计费归属不一致且已有账户的状态。
	exec(`UPDATE group_users SET removed_at=now() WHERE group_id=$1`, legacy)
	exec(`INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$2)`, member, user)
	migration("up")
	after, err := s.Account(ctx, user)
	if err != nil || after != before {
		t.Fatalf("迁移不应修改当期账户或历史归属: before=%+v after=%+v err=%v", before, after, err)
	}
	quota, groupID, _, err := effectiveQuota(ctx, s.pool, user)
	if err != nil || quota != amountText("50000") || groupID != member {
		t.Fatalf("迁移后应按已有成员关系继承: quota=%s group=%s err=%v", quota, groupID, err)
	}
	var columns int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='users' AND column_name='billing_group_id'`).Scan(&columns); err != nil || columns != 0 {
		t.Fatal("独立归属字段仍存在", columns, err)
	}
	var entries int
	var balance string
	if err := s.pool.QueryRow(ctx, `SELECT count(*), sum(credit_delta)::text FROM credit_ledger_entries WHERE account_id=$1`, before.ID).Scan(&entries, &balance); err != nil || entries != 1 || amountText(balance) != before.Balance {
		t.Fatal("迁移应保留原始发放流水", entries, balance, err)
	}
}

func TestQuotaListUsesCurrentAccountBalances(t *testing.T) {
	s, user, _ := fixture(t)
	ctx := t.Context()
	now := time.Now().UTC()
	currentStart := now.Add(-24 * time.Hour)
	if _, err := s.pool.Exec(ctx, `INSERT INTO credit_accounts
		(user_id,balance,frozen,quota,period_start_at,period_end_at,last_refreshed_at) VALUES
		($1,999,0,999,$2,$3,$3),($1,150,30,150,$3,$4,$3)`,
		user, now.Add(-48*time.Hour), currentStart, now.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	users, err := resource.DecodeObjects(sqlc.New(s.pool).ListUserQuotas(ctx, sqlc.ListUserQuotasParams{RootGroup: rootGroup, RootCredits: "10000", PeriodStartAt: currentStart}))
	if err != nil || len(users) != 1 {
		t.Fatalf("读取额度列表: %v %v", users, err)
	}
	if got := amountText(users[0].String("balance_credits")); got != amountText("150") {
		t.Fatalf("账面剩余应读取当前账户并忽略过期账户: got=%s", got)
	}
	if got := amountText(users[0].String("available_credits")); got != amountText("120") {
		t.Fatalf("可用积分应扣除冻结额: got=%s", got)
	}
}

func TestGroupChangesPreserveCurrentAccount(t *testing.T) {
	s, user, _ := fixture(t)
	ctx := t.Context()
	groups := group.NewService(s.pool).WithAccountPreserver(s)
	low, high := resource.ID(), resource.ID()
	if _, err := s.pool.Exec(ctx, `INSERT INTO groups(id,name) VALUES($1,'低额度'),($2,'高额度')`, low, high); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO billing_quotas(subject_type,group_id,credits_per_cycle,updated_by_user_id) VALUES('group',$1,50000,$3),('group',$2,80000,$3)`, low, high, user); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$2)`, low, user); err != nil {
		t.Fatal(err)
	}
	// 尚未开户的成员也应在调整分组前固化原周期额度。
	if _, err := groups.SetMembers(ctx, user, high, []string{user}); err != nil {
		t.Fatal(err)
	}
	before, err := s.Account(ctx, user)
	if err != nil || before.Quota != amountText("50000") {
		t.Fatal(before, err)
	}
	checkCurrent := func(want Account) {
		t.Helper()
		actual, err := s.Account(ctx, user)
		if err != nil || actual != want {
			t.Fatalf("分组变更重置了当期账户: got=%+v want=%+v err=%v", actual, want, err)
		}
	}
	s.now = func() time.Time { return time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC) }
	next, err := s.Account(ctx, user)
	if err != nil || next.Quota != amountText("80000") || next.GroupID != high {
		t.Fatal(next, err)
	}
	if err := groups.Delete(ctx, user, high); err != nil {
		t.Fatal(err)
	}
	checkCurrent(next)
	if quota, _, _, err := effectiveQuota(ctx, s.pool, user); err != nil || quota != amountText("50000") {
		t.Fatal(quota, err)
	}
	if _, err := groups.SetMembers(ctx, user, low, []string{}); err != nil {
		t.Fatal(err)
	}
	checkCurrent(next)
	s.now = func() time.Time { return time.Date(2026, 11, 7, 0, 0, 0, 0, time.UTC) }
	last, err := s.Account(ctx, user)
	if err != nil || last.Quota != amountText("10000") || last.GroupID != "" {
		t.Fatal(last, err)
	}
}
