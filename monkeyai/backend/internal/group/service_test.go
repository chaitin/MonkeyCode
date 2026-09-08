package group

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestGroups(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行分组集成测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	schema := "test_groups_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	migrations, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range migrations {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(data)); err != nil {
			t.Fatal(err)
		}
	}
	actor, member := resource.ID(), resource.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'管理员','admin@example.com','admin'),($2,'成员','member@example.com','user')`, actor, member); err != nil {
		t.Fatal(err)
	}
	for token, id := range map[string]string{"admin-session": actor, "member-session": member} {
		hash := fmt.Sprintf("%x", sha256.Sum256([]byte(token)))
		if _, err = pool.Exec(ctx, `INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, hash, id); err != nil {
			t.Fatal(err)
		}
	}
	service := NewService(pool)
	router := chi.NewRouter()
	router.Use(identity.NewService(pool, nil, "http://localhost", "http://localhost").RequireAdmin)
	service.RegisterAdmin(router)
	call := func(method, path string, body any, token string) *httptest.ResponseRecorder {
		data, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		if token != "" {
			req.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: token})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	must := func(method, path string, body any, status int) Group {
		t.Helper()
		response := call(method, path, body, "admin-session")
		if response.Code != status {
			t.Fatalf("%s %s: %d %s，预期 %d", method, path, response.Code, response.Body.String(), status)
		}
		var group Group
		if status != 204 {
			_ = json.Unmarshal(response.Body.Bytes(), &group)
		}
		return group
	}
	groups, err := service.List(ctx)
	if err != nil || len(groups) != 0 {
		t.Fatalf("初始化不应创建分组: %v, %v", groups, err)
	}
	testLegacyGroups(t, pool, actor, member)
	rootID := resource.ID()
	create := func(name string, parent any) Group {
		t.Helper()
		return must("POST", "/groups", map[string]any{"name": name, "parent_id": parent}, 201)
	}
	for _, method := range []string{"GET", "POST", "PATCH", "PUT", "DELETE"} {
		path := "/groups"
		if method == "PATCH" || method == "DELETE" {
			path += "/" + rootID
		}
		if method == "PUT" {
			path += "/" + rootID + "/members"
		}
		for token, status := range map[string]int{"": 401, "member-session": 403} {
			if response := call(method, path, map[string]any{}, token); response.Code != status {
				t.Fatalf("%s 权限校验 = %d，预期 %d", method, response.Code, status)
			}
		}
	}
	for _, body := range []any{nil, []any{}, map[string]any{}, map[string]any{"name": "  ", "parent_id": rootID}, map[string]any{"name": strings.Repeat("组", 101), "parent_id": rootID}} {
		must("POST", "/groups", body, 400)
	}
	parent := create("  研发  ", nil)
	if parent.Name != "研发" || parent.MemberIDs == nil {
		t.Fatalf("新分组返回错误: %+v", parent)
	}
	child := create("前端", parent.ID)
	other := create("产品", nil)
	must("POST", "/groups", map[string]any{"name": "研发", "parent_id": nil}, 409)
	must("PATCH", "/groups/"+other.ID, map[string]any{"name": "研发"}, 409)
	must("PATCH", "/groups/"+parent.ID, map[string]any{"parent_id": child.ID}, 409)
	must("PATCH", "/groups/"+parent.ID, map[string]any{"parent_id": parent.ID}, 409)
	must("PATCH", "/groups/"+parent.ID, map[string]any{"parent_id": resource.ID()}, 404)
	must("DELETE", "/groups/"+parent.ID, nil, 409)
	implicit := must("POST", "/groups", map[string]any{"name": "未指定上级"}, 201)
	if implicit.ParentID != nil || parent.ParentID != nil || other.ParentID != nil {
		t.Fatal("顶层分组 parent_id 应为 null")
	}
	must("PUT", "/groups/"+implicit.ID+"/members", map[string]any{"member_ids": []string{actor}}, 200)
	must("DELETE", "/groups/"+implicit.ID, nil, 204)
	moved := must("PATCH", "/groups/"+other.ID, map[string]any{"parent_id": parent.ID}, 200)
	if moved.ParentID == nil || *moved.ParentID != parent.ID {
		t.Fatal("顶层分组不能移动")
	}
	moved = must("PATCH", "/groups/"+other.ID, map[string]any{"name": "产品组"}, 200)
	if moved.ParentID == nil || *moved.ParentID != parent.ID {
		t.Fatal("仅改名时不应更改上级")
	}
	moved = must("PATCH", "/groups/"+other.ID, map[string]any{"parent_id": nil}, 200)
	if moved.ParentID != nil {
		t.Fatal("显式 null 未将分组移回团队根节点")
	}
	must("PATCH", "/groups/"+other.ID, map[string]any{"parent_id": 1}, 400)
	must("POST", "/groups", map[string]any{"name": "虚拟根不能入库", "parent_id": "team"}, 400)

	child = must("PUT", "/groups/"+child.ID+"/members", map[string]any{"member_ids": []string{member, member, actor}}, 200)
	if len(child.MemberIDs) != 2 {
		t.Fatalf("成员未去重: %v", child.MemberIDs)
	}
	must("PUT", "/groups/"+child.ID+"/members", map[string]any{"member_ids": []string{resource.ID()}}, 400)
	must("PUT", "/groups/"+child.ID+"/members", map[string]any{}, 400)
	must("PUT", "/groups/"+child.ID+"/members", map[string]any{"member_ids": nil}, 400)
	must("PUT", "/groups/"+child.ID+"/members", map[string]any{"member_ids": []string{"invalid"}}, 400)
	groups, err = NewService(pool).List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	persisted := groups[slices.IndexFunc(groups, func(g Group) bool { return g.ID == child.ID })]
	if len(persisted.MemberIDs) != 2 {
		t.Fatal("失败的成员更新没有回滚")
	}
	resourceID := resource.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,group_id,access_level,usage_requirement,granted_by_user_id) VALUES('rule',$1,$2,'read_only','optional',$3)`, resourceID, parent.ID, actor); err != nil {
		t.Fatal(err)
	}
	allowed := func(want bool) {
		t.Helper()
		got, err := resource.Allowed(ctx, pool, "rule", resourceID, member)
		if err != nil || got != want {
			t.Fatalf("父分组授权=%v, err=%v，预期 %v", got, err, want)
		}
	}
	privateResource := resource.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,group_id,access_level,usage_requirement,granted_by_user_id) VALUES('rule',$1,$2,'read_only','optional',$3)`, privateResource, other.ID, actor); err != nil {
		t.Fatal(err)
	}
	for _, user := range []string{actor, member} {
		ok, err := resource.Allowed(ctx, pool, "rule", privateResource, user)
		if err != nil || ok {
			t.Fatalf("未加入顶层分组的用户不应继承授权: %v, %v", ok, err)
		}
	}
	allowed(true)
	must("PATCH", "/groups/"+child.ID, map[string]any{"parent_id": other.ID}, 200)
	allowed(false)
	must("PATCH", "/groups/"+child.ID, map[string]any{"parent_id": parent.ID, "name": "客户端"}, 200)
	allowed(true)
	must("PUT", "/groups/"+child.ID+"/members", map[string]any{"member_ids": []string{}}, 200)
	allowed(false)
	must("PUT", "/groups/"+child.ID+"/members", map[string]any{"member_ids": []string{member}}, 200)
	allowed(true)
	if _, err = pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,group_id,access_level,usage_requirement,granted_by_user_id) VALUES('rule',$1,$2,'read_only','optional',$3)`, resourceID, child.ID, actor); err != nil {
		t.Fatal(err)
	}
	must("DELETE", "/groups/"+child.ID, nil, 204)
	allowed(false)
	must("DELETE", "/groups/"+child.ID, nil, 404)
	var memberships, grants, accounts, audits int
	if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM group_users WHERE group_id=$1 AND removed_at IS NULL),(SELECT count(*) FROM resource_access_grants WHERE group_id=$1),(SELECT count(*) FROM users WHERE deleted_at IS NULL),(SELECT count(*) FROM audits WHERE target_id=$1)`, child.ID).Scan(&memberships, &grants, &accounts, &audits); err != nil {
		t.Fatal(err)
	}
	if memberships != 0 || grants != 0 || accounts != 2 || audits < 4 {
		t.Fatalf("删除清理或操作记录错误: %d %d %d %d", memberships, grants, accounts, audits)
	}
	must("DELETE", "/groups/"+parent.ID, nil, 204)
	must("POST", "/groups", map[string]any{"name": "已删除父组", "parent_id": parent.ID}, 404)

	// 相互移动并发执行时，只允许其中一次成功。
	a, b := create("并发 A", nil), create("并发 B", nil)
	codes := make(chan int, 2)
	for _, pair := range [][2]string{{a.ID, b.ID}, {b.ID, a.ID}} {
		go func() {
			codes <- call("PATCH", "/groups/"+pair[0], map[string]any{"parent_id": pair[1]}, "admin-session").Code
		}()
	}
	got := []int{<-codes, <-codes}
	slices.Sort(got)
	if !slices.Equal(got, []int{200, 409}) {
		t.Fatalf("并发移动结果: %v", got)
	}
	response := call("GET", "/groups", nil, "admin-session")
	var list struct {
		Groups []Group `json:"groups"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &list) != nil {
		t.Fatalf("读取分组失败: %s", response.Body.String())
	}
	for _, group := range list.Groups {
		if group.ID == child.ID || group.ID == parent.ID {
			t.Fatal("列表仍包含已删除的分组")
		}
	}
}

func testLegacyGroups(t *testing.T, pool *pgxpool.Pool, actor, member string) {
	t.Helper()
	ctx := t.Context()
	upgrade, err := os.ReadFile(filepath.Join("..", "..", "migrations", "000003_group_virtual_root.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	// 新库执行增量迁移也不能初始化分组。
	if _, err = pool.Exec(ctx, string(upgrade)); err != nil {
		t.Fatal(err)
	}
	groups, err := NewService(pool).List(ctx)
	if err != nil || len(groups) != 0 {
		t.Fatalf("新库迁移创建了分组: %v %v", groups, err)
	}
	root, admin := "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"
	custom, nested, item := resource.ID(), resource.ID(), resource.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO groups(id,parent_id,name) VALUES($1,NULL,'旧团队'),($2,$1,'管理员'),($3,$1,'旧业务组'),($4,$2,'旧管理员子组')`, root, admin, custom, nested); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `CREATE UNIQUE INDEX groups_one_active_root_key ON groups ((true)) WHERE parent_id IS NULL AND deleted_at IS NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$3)`, nested, member, actor); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,group_id,access_level,usage_requirement,granted_by_user_id) VALUES('rule',$1,$2,'read_only','optional',$4),('rule',$1,$3,'read_write','required',$4)`, item, root, admin, actor); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,usage_requirement,granted_by_user_id) VALUES('rule',$1,$2,'read_only','optional',$3)`, item, member, actor); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO settings(key,value,updated_by_user_id) VALUES('billing','{}',$1)`, actor); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO billing_quotas(subject_type,group_id,credits_per_cycle,updated_by_user_id) VALUES('group',$1,222,$3),('group',$2,77,$3)`, root, admin, actor); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE users SET billing_group_id=$1 WHERE id=$2`, root, member); err != nil {
		t.Fatal(err)
	}
	var account string
	if err = pool.QueryRow(ctx, `INSERT INTO credit_accounts(user_id,balance,quota,group_id,period_start_at,period_end_at,last_refreshed_at) VALUES($1,42,222,$2,now(),now()+interval '1 month',now()) RETURNING id`, member, root).Scan(&account); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,occurred_at,group_id,sequence) VALUES($1,$2,'grant','other','旧周期额度',42,42,now(),$3,1)`, account, member, root); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(upgrade)); err != nil {
		t.Fatal(err)
	}
	groups, err = NewService(pool).List(ctx)
	if err != nil || len(groups) != 2 {
		t.Fatalf("旧库升级后的分组: %v %v", groups, err)
	}
	var rootCredits, adminCredits, childCredits, balance, legacy string
	var billingGroup, accountGroup, ledgerGroup *string
	if err = pool.QueryRow(ctx, `SELECT (SELECT value->>'root_credits' FROM settings WHERE key='billing'),(SELECT credits_per_cycle::text FROM billing_quotas WHERE user_id=$1),(SELECT credits_per_cycle::text FROM billing_quotas WHERE group_id=$2),(SELECT billing_group_id::text FROM users WHERE id=$3)`, actor, nested, member).Scan(&rootCredits, &adminCredits, &childCredits, &billingGroup); err != nil {
		t.Fatal(err)
	}
	if rootCredits != "222.000000" || adminCredits != "77.000000" || childCredits != "77.000000" || billingGroup != nil {
		t.Fatalf("旧额度迁移错误: %s %s %s %v", rootCredits, adminCredits, childCredits, billingGroup)
	}
	if err = pool.QueryRow(ctx, `SELECT a.balance::text,a.group_id::text,e.group_id::text,e.metadata->>'legacy_group_id' FROM credit_accounts a JOIN credit_ledger_entries e ON e.account_id=a.id WHERE a.id=$1`, account).Scan(&balance, &accountGroup, &ledgerGroup, &legacy); err != nil {
		t.Fatal(err)
	}
	if balance != "42.000000" || accountGroup != nil || ledgerGroup != nil || legacy != root {
		t.Fatalf("旧账户流水迁移错误: %s %v %v %s", balance, accountGroup, ledgerGroup, legacy)
	}
	if _, err = pool.Exec(ctx, `UPDATE credit_ledger_entries SET balance_after=0 WHERE account_id=$1`, account); err == nil {
		t.Fatal("迁移后流水防修改触发器未恢复")
	}
	for _, group := range groups {
		if group.ParentID != nil || group.ID == root || group.ID == admin {
			t.Fatalf("旧系统分组未移除或子分组未提升: %+v", group)
		}
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM resource_access_grants WHERE resource_id=$1 AND user_id IN ($2,$3) AND access_level='read_write' AND usage_requirement='required'`, item, actor, member).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("旧授权展开或合并错误: %d", count)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM group_users WHERE group_id=$1 AND user_id=$2 AND removed_at IS NULL`, nested, member).Scan(&count); err != nil || count != 1 {
		t.Fatalf("自定义组成员关系丢失: %d %v", count, err)
	}
	if _, err = pool.Exec(ctx, string(upgrade)); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `DELETE FROM resource_access_grants WHERE resource_id=$1`, item); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `DELETE FROM group_users WHERE group_id=$1`, nested); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `DELETE FROM billing_quotas WHERE group_id IN ($1,$2)`, custom, nested); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `DELETE FROM groups WHERE id IN ($1,$2)`, custom, nested); err != nil {
		t.Fatal(err)
	}

}
