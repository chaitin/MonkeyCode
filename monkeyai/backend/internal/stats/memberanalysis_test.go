package stats

import (
	"math/big"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

const memberAnalysisPath = "/statistics/session-reporting/members/"

func analysisSession(t *testing.T, s *Service, user string, at time.Time) string {
	t.Helper()
	id := resource.ID()
	conversationSession(t, s, user, id, "真实任务", at)
	exec(t, s, `UPDATE sessions SET turn_count=7,turn_count_verified=true WHERE id=$1`, id)
	return id
}

func TestMemberAnalysisValidation(t *testing.T) {
	for _, path := range []string{"not-a-uuid", "00000000-0000-0000-0000-000000000000", resource.ID() + "?range=30d", resource.ID() + "?user_id=" + resource.ID()} {
		request(t, &Service{}, memberAnalysisPath+path, 400)
	}
}

func TestMemberAnalysisEmptyAndMissing(t *testing.T) {
	s, user, _ := fixture(t)
	out := request(t, s, memberAnalysisPath+user, 200)
	number(t, out["summary"].(map[string]any), "tasks", 0)
	number(t, out["summary"].(map[string]any), "conversations", 0)
	if value, ok := new(big.Rat).SetString(out["summary"].(map[string]any)["credits"].(string)); !ok || value.Sign() != 0 {
		t.Fatal(out)
	}
	if len(out["recent_tasks"].([]any)) != 0 {
		t.Fatal(out)
	}
	member := out["member"].(map[string]any)
	if member["id"] != user || member["avatar_url"] != nil || len(member["groups"].([]any)) != 0 {
		t.Fatal(member)
	}
	resources := out["created_resources"].(map[string]any)
	number(t, resources, "models", 1)
	if resources["knowledge_bases"] != nil {
		t.Fatal(resources)
	}
	days := out["activity"].(map[string]any)["days"].([]any)
	if len(days) != 365 {
		t.Fatalf("日期数量: %d", len(days))
	}
	for _, raw := range days {
		number(t, raw.(map[string]any), "conversations", 0)
	}
	exec(t, s, `UPDATE users SET status='disabled',disabled_at=$1 WHERE id=$2`, s.now(), user)
	if request(t, s, memberAnalysisPath+user, 200)["member"].(map[string]any)["status"] != "disabled" {
		t.Fatal("停用成员仍应可读")
	}
	exec(t, s, `UPDATE users SET deleted_at=$1 WHERE id=$2`, s.now(), user)
	request(t, s, memberAnalysisPath+user, 404)
	request(t, s, memberAnalysisPath+resource.ID(), 404)
}

func TestMemberAnalysisHistoryScopeAndWindows(t *testing.T) {
	s, user, model := fixture(t)
	now := time.Date(2026, 11, 3, 16, 5, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	zone := time.FixedZone("Asia/Shanghai", 8*60*60)
	today := time.Date(2026, 11, 4, 0, 0, 0, 0, zone)
	first := today.AddDate(-1, 0, 1)
	summaryFrom := today.AddDate(0, 0, -29)
	old := analysisSession(t, s, user, first.Add(-time.Hour))
	current := analysisSession(t, s, user, summaryFrom)
	tie := analysisSession(t, s, user, summaryFrom)
	for _, sample := range []struct {
		session string
		at      time.Time
	}{
		{old, first.Add(-time.Microsecond)}, {old, first},
		{old, summaryFrom.Add(-time.Microsecond)}, {old, summaryFrom},
		{old, today.Add(-time.Microsecond)}, {current, today},
		{current, now.Add(-time.Microsecond)}, {current, now}, {current, now.Add(time.Hour)},
	} {
		var index int
		if err := s.pool.QueryRow(t.Context(), `SELECT coalesce(max(turn_index),0)+1 FROM session_turns WHERE session_id=$1`, sample.session).Scan(&index); err != nil {
			t.Fatal(err)
		}
		conversationTurn(t, s, sample.session, index, sample.at, "error", nil, 0, 0)
	}
	// Records excluded by both history pages must not inflate the summary or heatmap.
	for _, mode := range []string{"deleted", "purged", "placeholder", "unreported", "child", "other"} {
		owner := user
		if mode == "other" {
			owner = resource.ID()
			exec(t, s, `INSERT INTO users(id,name,email) VALUES($1,'其他成员','other-analysis@example.test')`, owner)
		}
		id := analysisSession(t, s, owner, now.Add(-time.Hour))
		conversationTurn(t, s, id, 1, now.Add(-time.Minute), "complete", "secret", 0, 0)
		switch mode {
		case "deleted":
			exec(t, s, `UPDATE sessions SET deleted_at=$2 WHERE id=$1`, id, now)
		case "purged":
			exec(t, s, `UPDATE sessions SET purged_at=$2 WHERE id=$1`, id, now)
		case "placeholder":
			exec(t, s, `UPDATE sessions SET placeholder=true WHERE id=$1`, id)
		case "unreported":
			exec(t, s, `UPDATE sessions SET reporting_enabled_at=NULL WHERE id=$1`, id)
		case "child":
			exec(t, s, `UPDATE sessions SET parent_session_id=$2 WHERE id=$1`, id, old)
		}
	}
	// Model calls without reported conversations are not conversations.
	call(t, s, user, model, "succeeded", now.Add(-time.Minute), now.Add(-time.Second), 100, 0, 1, 1)
	out := request(t, s, memberAnalysisPath+user, 200)
	summary := out["summary"].(map[string]any)
	number(t, summary, "tasks", 2)
	number(t, summary, "conversations", 4)
	from, err := time.Parse(time.RFC3339, summary["from"].(string))
	if err != nil || !from.Equal(summaryFrom) {
		t.Fatal(summary)
	}
	activity := out["activity"].(map[string]any)
	if activity["from"] != first.Format(time.DateOnly) || activity["until"] != today.Format(time.DateOnly) {
		t.Fatal(activity)
	}
	days := activity["days"].([]any)
	if len(days) != 365 {
		t.Fatal(len(days))
	}
	totals := map[string]float64{first.Format(time.DateOnly): 1, summaryFrom.Add(-time.Microsecond).Format(time.DateOnly): 1, summaryFrom.Format(time.DateOnly): 1, today.Add(-time.Microsecond).Format(time.DateOnly): 1, today.Format(time.DateOnly): 2}
	for index, raw := range days {
		row := raw.(map[string]any)
		date := first.AddDate(0, 0, index).Format(time.DateOnly)
		if row["date"] != date {
			t.Fatal(row)
		}
		number(t, row, "conversations", totals[date])
	}
	recent := out["recent_tasks"].([]any)
	if len(recent) != 3 {
		t.Fatal(recent)
	}
	wantFirst, wantSecond := current, tie
	if wantFirst < wantSecond {
		wantFirst, wantSecond = wantSecond, wantFirst
	}
	if recent[0].(map[string]any)["id"] != wantFirst || recent[1].(map[string]any)["id"] != wantSecond {
		t.Fatal(recent)
	}
	history := request(t, s, "/statistics/history?user_id="+user+"&page_size=10", 200)["items"].([]any)
	if len(history) != len(recent) {
		t.Fatal(history, recent)
	}
	for index, raw := range recent {
		if raw.(map[string]any)["id"] != history[index].(map[string]any)["id"] {
			t.Fatal(recent, history)
		}
	}
}

func TestMemberAnalysisRecentTen(t *testing.T) {
	s, user, _ := fixture(t)
	var ids []string
	for index := range 14 {
		id := analysisSession(t, s, user, s.now().Add(-time.Duration(index+1)*time.Hour))
		ids = append(ids, id)
	}
	exec(t, s, `UPDATE sessions SET turn_count_verified=false WHERE id=$1`, ids[0])
	out := request(t, s, memberAnalysisPath+user, 200)
	recent := out["recent_tasks"].([]any)
	if len(recent) != 10 {
		t.Fatal(len(recent))
	}
	for index, raw := range recent {
		row := raw.(map[string]any)
		if row["id"] != ids[index] {
			t.Fatal(recent)
		}
		if index == 0 {
			if row["turn_count"] != nil {
				t.Fatal(row)
			}
		} else {
			number(t, row, "turn_count", 7)
		}
	}
}

func TestMemberAnalysisGroupsAndResources(t *testing.T) {
	s, user, _ := fixture(t)
	other := resource.ID()
	exec(t, s, `INSERT INTO users(id,name,email) VALUES($1,'资源所有者','resource-owner@example.test')`, other)
	exec(t, s, `UPDATE users SET custom_avatar_url='  https://example.test/custom.png  ',avatar_url='https://example.test/oauth.png' WHERE id=$1`, user)
	for index, mode := range []string{"active", "removed", "deleted"} {
		group := resource.ID()
		exec(t, s, `INSERT INTO groups(id,name) VALUES($1,$2)`, group, mode)
		exec(t, s, `INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$2)`, group, user)
		if index == 0 {
			exec(t, s, `INSERT INTO group_users(group_id,user_id,assigned_by_user_id,removed_at) VALUES($1,$2,$2,$3)`, group, user, s.now())
		}
		if mode == "removed" {
			exec(t, s, `UPDATE group_users SET removed_at=$1 WHERE group_id=$2`, s.now(), group)
		}
		if mode == "deleted" {
			exec(t, s, `UPDATE groups SET deleted_at=$1 WHERE id=$2`, s.now(), group)
		}
	}
	for _, mode := range []string{"local", "disabled", "deleted", "package", "other"} {
		owner, origin := user, "local"
		if mode == "package" {
			origin = "package"
		}
		if mode == "other" {
			owner = other
		}
		skill, rule, connector, expert := resource.ID(), resource.ID(), resource.ID(), resource.ID()
		exec(t, s, `INSERT INTO skills(id,ownership_type,owner_user_id,name,description,package_file_name,package_s3_key,package_size_bytes,package_sha256,origin) VALUES($1,'system',$2,($1::uuid)::text,'','file.zip','key',0,'hash',$3)`, skill, owner, origin)
		exec(t, s, `INSERT INTO rules(id,ownership_type,owner_user_id,name,content,origin) VALUES($1,'user',$2,($1::uuid)::text,'规则内容','local')`, rule, owner)
		if mode == "package" {
			exec(t, s, `UPDATE rules SET ownership_type='system',origin='package' WHERE id=$1`, rule)
		}
		exec(t, s, `INSERT INTO connectors(id,owner_user_id,name,url,authorization_mode,origin) VALUES($1,$2,($1::uuid)::text,'https://example.test','none',$3)`, connector, owner, origin)
		// Authorship is the creator, even when ownership differs.
		expertOwner := owner
		if mode == "local" {
			expertOwner = other
		}
		exec(t, s, `INSERT INTO experts(id,name,description,prompt,created_by_user_id,owner_user_id,origin) VALUES($1,($1::uuid)::text,'','prompt',$2,$3,$4)`, expert, owner, expertOwner, origin)
		if mode == "disabled" {
			exec(t, s, `UPDATE skills SET enabled=false WHERE id=$1`, skill)
			exec(t, s, `UPDATE connectors SET enabled=false WHERE id=$1`, connector)
			exec(t, s, `UPDATE experts SET enabled=false WHERE id=$1`, expert)
		}
		if mode == "deleted" {
			for _, table := range []string{"skills", "rules", "connectors", "experts"} {
				var id string
				switch table {
				case "skills":
					id = skill
				case "rules":
					id = rule
				case "connectors":
					id = connector
				case "experts":
					id = expert
				}
				exec(t, s, `UPDATE `+table+` SET deleted_at=$1 WHERE id=$2`, s.now(), id)
			}
		}
	}
	exec(t, s, `INSERT INTO models(owner_user_id,ownership_type,model_id,display_name,protocol,base_url,api_key,advanced_config,enabled) VALUES($1,'user','disabled','禁用模型','anthropic','https://example.test','secret','{}',false)`, user)
	exec(t, s, `INSERT INTO models(owner_user_id,ownership_type,model_id,display_name,protocol,base_url,api_key,advanced_config,deleted_at) VALUES($1,'user','deleted','删除模型','anthropic','https://example.test','secret','{}',$2)`, user, s.now())
	exec(t, s, `INSERT INTO models(owner_user_id,ownership_type,model_id,display_name,protocol,base_url,api_key,advanced_config,kind,provider,image_config,image_pricing) VALUES($1,'user','image','图片模型','image_generation','https://example.test','secret','{}','image','openai','{}','{}')`, user)
	exec(t, s, `INSERT INTO models(owner_user_id,ownership_type,model_id,display_name,protocol,base_url,api_key,advanced_config,kind,provider,video_config,video_pricing) VALUES($1,'user','video','视频模型','video_generation','https://example.test','secret','{}','video','xai','{}','{}')`, user)
	out := request(t, s, memberAnalysisPath+user, 200)
	resources := out["created_resources"].(map[string]any)
	number(t, resources, "models", 4)
	for _, key := range []string{"skills", "experts", "connectors", "rules"} {
		number(t, resources, key, 2)
	}
	if resources["knowledge_bases"] != nil {
		t.Fatal(resources)
	}
	member := out["member"].(map[string]any)
	if member["avatar_url"] != "https://example.test/custom.png" {
		t.Fatal(member)
	}
	groups := member["groups"].([]any)
	if len(groups) != 1 || groups[0].(map[string]any)["name"] != "active" {
		t.Fatal(groups)
	}
}

func TestMemberAnalysisCredits(t *testing.T) {
	s, user, model := fixture(t)
	now := s.now()
	zone := time.FixedZone("Asia/Shanghai", 8*60*60)
	local := now.In(zone)
	from := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, zone).AddDate(0, 0, -29)
	account := resource.ID()
	exec(t, s, `INSERT INTO credit_accounts(id,user_id,period_start_at,period_end_at,last_refreshed_at) VALUES($1,$2,$3,$4,$3)`, account, user, from.AddDate(0, 0, -1), now.Add(time.Hour))
	for _, entry := range []struct {
		kind, category, amount string
		at                     time.Time
	}{
		{"charge", "model", "-10.123456", from},
		{"charge", "tool", "-2.000001", now.Add(-time.Hour)},
		{"charge", "image", "-3", now.Add(-time.Hour)},
		{"charge", "video", "-4", now.Add(-time.Hour)},
		{"refund", "model", "5.000001", now.Add(-time.Minute)},
		{"charge", "model", "-1000", from.Add(-time.Microsecond)},
		{"charge", "model", "-1000", now},
		{"grant", "other", "10000", now.Add(-time.Hour)},
		{"adjustment", "other", "-10000", now.Add(-time.Hour)},
	} {
		exec(t, s, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,resource_type,resource_id,item_name,credit_delta,balance_after,occurred_at) VALUES($1,$2,$3,$4,'model',$5,'测试',$6,0,$7)`, account, user, entry.kind, entry.category, model, entry.amount, entry.at)
	}
	out := request(t, s, memberAnalysisPath+user, 200)
	got, ok := new(big.Rat).SetString(out["summary"].(map[string]any)["credits"].(string))
	want, _ := new(big.Rat).SetString("14.123456")
	if !ok || got.Cmp(want) != 0 {
		t.Fatal(out)
	}
	exec(t, s, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,occurred_at) VALUES($1,$2,'refund','model','退款',100,0,$3)`, account, user, now.Add(-time.Second))
	out = request(t, s, memberAnalysisPath+user, 200)
	got, ok = new(big.Rat).SetString(out["summary"].(map[string]any)["credits"].(string))
	want, _ = new(big.Rat).SetString("-85.876544")
	if !ok || got.Cmp(want) != 0 {
		t.Fatal(out)
	}
}

func TestMemberAnalysisLeapYear(t *testing.T) {
	s, user, _ := fixture(t)
	for _, now := range []time.Time{time.Date(2024, 3, 1, 16, 5, 0, 0, time.UTC), time.Date(2024, 2, 29, 12, 0, 0, 0, time.UTC)} {
		s.now = func() time.Time { return now }
		out := request(t, s, memberAnalysisPath+user, 200)
		days := out["activity"].(map[string]any)["days"].([]any)
		if len(days) != 366 {
			t.Fatalf("闰年应 366 天: %d %v", len(days), now)
		}
		for _, raw := range days {
			row := raw.(map[string]any)
			if row["date"] == "2024-02-29" {
				number(t, row, "conversations", 0)
			}
		}
	}
}
