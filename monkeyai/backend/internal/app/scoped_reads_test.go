package app

import (
	"encoding/json"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/url"
	"reflect"
	"slices"
	"strings"
	"testing"
)

func testScopedReads(t *testing.T, pool *pgxpool.Pool, get func(string, string, string, int) []byte, admin, lead, outside string) {
	ctx := t.Context()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	id := func(q string, args ...any) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, q, args...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	root := id("SELECT id FROM groups WHERE name='managed'")
	makeGroup := func(name string, parent any) string {
		return id("INSERT INTO groups(name,parent_id) VALUES($1,$2) RETURNING id", name, parent)
	}
	parent := makeGroup("parent", nil)
	exec("UPDATE groups SET parent_id=$2 WHERE id=$1", root, parent)
	child := makeGroup("child", root)
	grand := makeGroup("grandchild", child)
	extra := makeGroup("second", nil)
	dead := makeGroup("deleted", root)
	member := func(group, user string, super bool) {
		exec("INSERT INTO group_users(group_id,user_id,assigned_by_user_id,is_supervisor) VALUES($1,$2,$3,$4)", group, user, admin, super)
	}
	member(extra, lead, true)
	member(parent, outside, false)
	addUser := func(name string) string {
		return id("INSERT INTO users(name,email) VALUES($1,$2) RETURNING id", name, name+"@scope.test")
	}
	inside := addUser("inside")
	second := addUser("second")
	removed := addUser("removed")
	deleted := addUser("deleted")
	deadMember := addUser("dead-group")
	member(root, inside, false)
	member(grand, inside, false)
	member(extra, second, false)
	member(child, removed, false)
	member(child, deleted, false)
	member(dead, deadMember, false)
	exec("UPDATE users SET status='disabled' WHERE id=$1", inside)
	exec("UPDATE users SET deleted_at=now(),status='disabled' WHERE id=$1", deleted)
	exec("UPDATE groups SET deleted_at=now() WHERE id=$1", dead)
	exec("UPDATE group_users SET removed_at=now() WHERE user_id=$1", removed)
	// Leave inside only in the grandchild and the second managed root, to exercise overlap and later moves.
	exec("UPDATE group_users SET removed_at=now() WHERE user_id=$1 AND group_id=$2", inside, root)
	member(extra, inside, false)
	sessions := map[string]string{}
	for _, u := range []string{inside, second, outside, removed, deleted, deadMember} {
		exec("INSERT INTO audits(actor_type,actor_user_id,actor_name,action,category,target_id,request_params,result,occurred_at) VALUES('user',$1,'actor','save','model',$2,jsonb_build_object('note','private-marker'),'success',now())", u, outside)
		exec("INSERT INTO feedbacks(user_id,category,platform,state,request_hash) VALUES($1,'bug','web','new','sample')", u)
		exec("WITH a AS (INSERT INTO credit_accounts(user_id,period_start_at,period_end_at,last_refreshed_at) VALUES($1,now(),now()+interval '1 day',now()) RETURNING id,user_id) INSERT INTO credit_ledger_entries(account_id,user_id,item_name,entry_type,category,credit_delta,balance_after,occurred_at) SELECT id,user_id,'scope','charge','model',-1,0,now() FROM a", u)
		exec("INSERT INTO endpoints(user_id,machine_id,device_name,platform,os_version,arch,client_version,protocol_version) VALUES($1,gen_random_uuid(),'scope','linux','1','amd64','1',1)", u)
		s := id("INSERT INTO sessions(owner_user_id,title,session_type,client_type,client_name,started_at,last_active_at,reporting_enabled_at) VALUES($1,'scope','conversation','web','test',now()-interval '1 hour',now(),now()) RETURNING id", u)
		sessions[u] = s
		exec("INSERT INTO session_resource_snapshots(session_id,snapshot_id,items) VALUES($1,'snap','[]')", s)
		exec("INSERT INTO session_resource_snapshot_items(session_id,snapshot_id,resource_id,kind,version,enabled,available) VALUES($1,'snap','tool','builtin','1',true,true)", s)
		exec("INSERT INTO session_turns(session_id,turn_index,facts_version,report_hash,input_seq,started_at,ended_at,stop_reason,resources_snapshot_id,input_kind,input_text) VALUES($1,1,1,'hash',1,now()-interval '1 hour',now(),'complete','snap','prompt','test')", s)
	}
	call := func(path, who string) map[string]any {
		t.Helper()
		var data map[string]any
		if err := json.Unmarshal(get("GET", path, who, 200), &data); err != nil {
			t.Fatal(err)
		}
		return data
	}
	owners := func(page map[string]any, key string) []string {
		t.Helper()
		items, ok := page["items"].([]any)
		if !ok {
			t.Fatalf("缺少列表: %v", page)
		}
		ids := []string{}
		for _, item := range items {
			ids = append(ids, item.(map[string]any)[key].(string))
		}
		slices.Sort(ids)
		return ids
	}
	assertOwners := func(page map[string]any, key string, want ...string) {
		t.Helper()
		slices.Sort(want)
		if got := owners(page, key); !slices.Equal(got, want) {
			t.Fatalf("成员: %v, want %v", got, want)
		}
	}
	random := resource.ID()

	const membersOverview = "/statistics/session-reporting/members/overview"
	const sessionsOverview = "/statistics/session-reporting/sessions/overview"
	const envPath = "/environments"
	host := id("INSERT INTO hosts(user_id,name,architecture,version) VALUES($1,'scope-host','amd64','test') RETURNING id", outside)
	for n, u := range []string{inside, second, outside, removed, deleted, deadMember} {
		exec("INSERT INTO environments(id,instance_id,user_id,host_id,name,desired,generation,phase,observed_generation,spec,cpu_millis,memory_bytes,created_at) VALUES(gen_random_uuid(),gen_random_uuid(),$1,$2,'scope-env','running',1,'running',1,jsonb_build_object('runtime',jsonb_build_object('token','not-for-list')),1000,1073741824,now() - $3::int * interval '1 minute')", u, host, n)
	}
	for _, path := range []string{membersOverview, sessionsOverview, envPath, "/users/" + inside} {
		get("GET", path, "", 401)
		get("GET", path, "ordinary", 403)
	}
	for _, uid := range []string{outside, removed, deleted, deadMember, random} {
		get("GET", "/users/"+uid, "lead", 404)
	}
	get("GET", "/users/bad", "lead", 400)
	get("PATCH", "/users/"+inside, "lead", 403)
	for _, who := range []string{"admin", "lead"} {
		if profile := call("/users/"+inside, who); profile["id"] != inside || profile["status"] != "disabled" {
			t.Fatal(profile)
		}
	}
	checkMembers := func(visible ...string) {
		t.Helper()
		m := call(membersOverview, "lead")
		if m["total_members"] != float64(len(visible)+1) || m["last_24h"].(map[string]any)["active_members"] != float64(len(visible)) {
			t.Fatal(m)
		}
		top := m["message_depth"].(map[string]any)["top_members"]
		assertOwners(map[string]any{"items": top}, "id", visible...)
		days := m["days"].([]any)
		sum := 0.
		for _, d := range days {
			sum += d.(map[string]any)["active_members"].(float64)
		}
		if len(days) != 90 || sum != float64(len(visible)) {
			t.Fatal(days)
		}
	}
	checkMembers(inside, second)
	for who, n := range map[string]float64{"admin": 6, "lead": 2} {
		s := call(sessionsOverview, who)
		last := s["last_24h"].(map[string]any)
		if s["total_sessions"] != n || s["total_messages"] != n || s["new_sessions_24h"] != n || last["outcomes"].(map[string]any)["complete"] != n || last["models"].([]any)[0].(map[string]any)["messages"] != n {
			t.Fatal(s)
		}
	}
	for _, p := range []string{sessionsOverview, membersOverview} {
		get("GET", p+"?user_id="+outside, "lead", 400)
	}
	assertOwners(call(envPath, "lead"), "user_id", inside, second)
	assertOwners(call(envPath, "admin"), "user_id", inside, second, outside, removed, deleted, deadMember)
	assertOwners(call(envPath+"?host_id="+host+"&user_id="+inside, "lead"), "user_id", inside)
	assertOwners(call(envPath+"?page=2&page_size=1", "lead"), "user_id", second)
	for _, uid := range []string{outside, random} {
		assertOwners(call(envPath+"?user_id="+uid, "lead"), "user_id")
	}
	get("GET", envPath+"?host_id=bad", "lead", 400)
	get("GET", envPath+"?page_size=101", "lead", 400)
	if strings.Contains(string(get("GET", envPath, "lead", 200)), "not-for-list") {
		t.Fatal("不应返回运行配置")
	}
	get("GET", envPath+"/"+random, "lead", 403)
	get("DELETE", envPath+"/"+random, "lead", 403)
	const analysis = "/statistics/session-reporting/members/"
	get("GET", analysis+inside, "", 401)
	get("GET", analysis+inside, "ordinary", 403)
	get("GET", analysis+"invalid", "lead", 400)
	for _, uid := range []string{outside, removed, deleted, deadMember, random} {
		get("GET", analysis+uid, "lead", 404)
	}
	for _, uid := range []string{inside, second} {
		detail := call(analysis+uid, "lead")
		summary := detail["summary"].(map[string]any)
		recent := detail["recent_tasks"].([]any)
		if detail["member"].(map[string]any)["id"] != uid || summary["tasks"] != 1.0 || summary["conversations"] != 1.0 || len(recent) != 1 || recent[0].(map[string]any)["id"] != sessions[uid] {
			t.Fatalf("成员分析范围错误: %s", uid)
		}
	}
	get("GET", analysis+outside, "admin", 200)

	const overview = "/endpoints/overview"
	const resources = "/statistics/session-reporting/resources"
	for _, path := range []string{"/audits", "/feedback", "/billing/entries", "/statistics/history", "/statistics/conversations", resources, "/endpoints", overview} {
		t.Run(path, func(t *testing.T) {
			key := "user_id"
			if path == "/audits" {
				key = "actor_user_id"
			}
			get("GET", path, "", 401)
			get("GET", path, "ordinary", 403)
			get("GET", path+"?"+key+"=bad", "lead", 400)
			all, managed := call(path, "admin"), call(path, "lead")
			if path == overview {
				if all["total"] != 6.0 || managed["total"] != 2.0 || managed["users"] != 2.0 {
					t.Fatal(all, managed)
				}
				for _, dist := range managed["distributions"].(map[string]any) {
					buckets := dist.([]any)
					if len(buckets) != 1 || buckets[0].(map[string]any)["count"] != 2.0 {
						t.Fatal(dist)
					}
				}
			} else {
				assertOwners(managed, key, inside, second)
				assertOwners(all, key, inside, second, outside, removed, deleted, deadMember)
				if total, ok := managed["total"]; ok && total != 2.0 {
					t.Fatal(managed)
				}
				if n, ok := managed["has_next"]; ok && n != false {
					t.Fatal(managed)
				}
				if path != resources {
					page := call(path+"?page=2&page_size=1", "lead")
					if ids := owners(page, key); len(ids) != 1 || ids[0] != inside && ids[0] != second || page["has_next"] == true {
						t.Fatal(page)
					}
					assertOwners(call(path+"?page=3&page_size=1", "lead"), key)
				}
			}
			empty := call(path+"?"+key+"="+outside, "lead")
			missing := call(path+"?"+key+"="+random, "lead")
			// The resource report includes request-clock metadata even for an empty result.
			if path == resources {
				for _, k := range []string{"from", "until", "generated_at"} {
					if empty[k] == nil || missing[k] == nil {
						t.Fatal(k)
					}
					delete(empty, k)
					delete(missing, k)
				}
			}
			if !reflect.DeepEqual(empty, missing) {
				t.Fatal(empty, missing)
			}
			if path == overview {
				if empty["total"] != 0.0 || empty["users"] != 0.0 {
					t.Fatal(empty)
				}
				for _, d := range empty["distributions"].(map[string]any) {
					if len(d.([]any)) != 0 {
						t.Fatal(d)
					}
				}
			} else {
				assertOwners(empty, key)
				if empty["has_next"] == true || empty["next_cursor"] != nil || empty["data_freshness_seconds"] != nil || empty["total"] != nil && empty["total"] != 0.0 {
					t.Fatal(empty)
				}
			}
		})
	}
	assertOwners(call("/users?scope=managed&q=", "lead"), "id", lead, inside, second)
	assertOwners(call("/users?scope=managed&id="+outside, "lead"), "id")
	get("GET", "/users?scope=bad", "lead", 400)
	assertOwners(call("/statistics/conversations?task_id="+sessions[outside], "lead"), "user_id")
	assertOwners(call("/statistics/conversations?task_id="+sessions[inside], "lead"), "user_id", inside)
	if bytes := get("GET", "/audits?actor_user_id="+inside, "lead", 200); strings.Contains(string(bytes), outside) || strings.Contains(string(bytes), "private-marker") {
		t.Fatal("审计泄露目标或请求内容")
	}
	assertOwners(call("/audits?params=private-marker", "lead"), "actor_user_id")
	cursor := call(resources+"?limit=1", "lead")["next_cursor"].(string)
	next := resources + "?limit=1&cursor=" + url.QueryEscape(cursor)
	get("GET", next, "outsider", 400)
	get("GET", next, "admin", 400)
	if got := owners(call(next, "lead"), "user_id"); len(got) != 1 || got[0] != second && got[0] != inside {
		t.Fatal(got)
	}
	for _, p := range []string{"/feedback/" + random, "/feedback/" + random + "/attachments/" + random, "/billing/reconciliation", "/billing/transactions/" + random, "/statistics/session-reporting/sessions/" + sessions[inside]} {
		get("GET", p, "lead", 403)
	}
	get("PATCH", "/feedback/"+random, "lead", 403)
	exec("UPDATE group_users SET removed_at=now() WHERE group_id=$1 AND user_id=$2", extra, inside)
	assertOwners(call("/feedback", "lead"), "user_id", inside, second)
	exec("UPDATE group_users SET removed_at=now() WHERE group_id=$1 AND user_id=$2", grand, inside)
	member(grand, outside, false)
	assertOwners(call("/feedback", "lead"), "user_id", outside, second)
	assertOwners(call("/users?scope=managed&id="+inside, "lead"), "id")
	checkMembers(outside, second)
	assertOwners(call(envPath, "lead"), "user_id", outside, second)
	get("GET", "/users/"+inside, "lead", 404)
	get("GET", "/users/"+outside, "lead", 200)
	get("GET", analysis+inside, "lead", 404)
	get("GET", analysis+outside, "lead", 200)
}
