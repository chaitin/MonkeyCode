package stats

import (
	"fmt"
	"math/big"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestOverviewShanghaiDays(t *testing.T) {
	s, user, model := fixture(t)
	now := time.Date(2026, 10, 20, 16, 5, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	zone := time.FixedZone("Asia/Shanghai", 8*60*60)
	today := time.Date(2026, 10, 21, 0, 0, 0, 0, zone)
	first := today.AddDate(0, 0, -89)
	exec(t, s, `UPDATE users SET created_at=$1 WHERE id=$2`, first.AddDate(0, 0, -1), user)
	account := resource.ID()
	exec(t, s, `INSERT INTO credit_accounts(id,user_id,period_start_at,period_end_at,last_refreshed_at) VALUES($1,$2,$3,$4,$3)`, account, user, first, now.Add(time.Hour))
	for i, sample := range []struct {
		at    time.Time
		input int64
	}{
		{first.Add(-time.Microsecond), 1000000},
		{first, 1},
		{today.AddDate(0, 0, -1).Add(-time.Microsecond), 10},
		{today.AddDate(0, 0, -1), 100},
		{today.Add(-time.Microsecond), 1000},
		{today, 10000},
		{now.Add(-time.Microsecond), 100000},
		{now, 1000000},
	} {
		owner, session := resource.ID(), resource.ID()
		exec(t, s, `INSERT INTO users(id,name,email,created_at) VALUES($1,'边界用户',$2,$3)`, owner, fmt.Sprintf("boundary-%d@example.test", i), sample.at)
		exec(t, s, `INSERT INTO sessions(id,owner_user_id,title,session_type,client_type,client_name,started_at,last_active_at,reporting_enabled_at)
			VALUES($1,$2,'边界任务','conversation','desktop','客户端',$3,$3,$3)`, session, owner, sample.at)
		exec(t, s, `INSERT INTO session_resource_snapshots(session_id,snapshot_id,items) VALUES($1,'snapshot','[]')`, session)
		exec(t, s, `INSERT INTO session_turns(session_id,turn_index,facts_version,report_hash,input_seq,started_at,ended_at,stop_reason,resources_snapshot_id,input_kind)
			VALUES($1,1,1,'hash',1,$2,$2,'complete','snapshot','text')`, session, sample.at)
		call(t, s, user, model, "succeeded", sample.at.Add(-time.Second), sample.at, sample.input, 0, sample.input, 1000)
		exec(t, s, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,occurred_at)
			VALUES($1,$2,'charge','model','边界模型',$3,0,$4)`, account, user, fmt.Sprint(-sample.input), sample.at)
	}
	for _, path := range []string{"/statistics/models/overview", "/statistics/tasks/overview", "/statistics/users"} {
		t.Run(path, func(t *testing.T) {
			out := request(t, s, path, 200)
			if out["timezone"] != "Asia/Shanghai" {
				t.Fatalf("时区错误: %v", out["timezone"])
			}
			days := out["days"].([]any)
			if len(days) != 90 {
				t.Fatalf("日期数错误: %d", len(days))
			}
			for i, raw := range days {
				row := raw.(map[string]any)
				if want := first.AddDate(0, 0, i).Format(time.DateOnly); row["date"] != want {
					t.Fatalf("北京时间日期错误: got=%v want=%s", row["date"], want)
				}
				count, tokens := float64(0), float64(0)
				switch i {
				case 0:
					count, tokens = 1, 1
				case 87:
					count, tokens = 1, 10
				case 88:
					count, tokens = 2, 1100
				case 89:
					count, tokens = 2, 110000
				}
				switch path {
				case "/statistics/models/overview":
					number(t, row, "model_calls", count)
					number(t, row, "input_tokens", tokens)
					number(t, row, "output_tokens", tokens)
					credits, ok := new(big.Rat).SetString(row["credits"].(string))
					if !ok || credits.Cmp(new(big.Rat).SetInt64(int64(tokens))) != 0 {
						t.Fatalf("积分日期归属错误: %v", row)
					}
				case "/statistics/tasks/overview":
					number(t, row, "new_tasks", count)
					number(t, row, "active_tasks", count)
				case "/statistics/users":
					number(t, row, "new_users", count)
					number(t, row, "active_users", count)
				}
			}
		})
	}
}

func TestTokenUsageKnown(t *testing.T) {
	s, user, model := fixture(t)
	now := s.now()
	account := resource.ID()
	exec(t, s, `INSERT INTO credit_accounts(id,user_id,period_start_at,period_end_at,last_refreshed_at) VALUES($1,$2,$3,$4,$3)`, account, user, now.Add(-48*time.Hour), now.Add(time.Hour))
	for _, sample := range []struct {
		status, code, usage string
		input, cached       int64
	}{
		{"succeeded", "", "", 10, 3},
		{"failed", "", "", 20, 5},
		{"failed", "usage_missing", "", 1000, 0},
		{"failed", "", `{"known":false}`, 2000, 0},
		{"cancelled", "upstream_failed", `{"known":true}`, 30, 10},
		{"failed", "upstream_failed", `{}`, 3000, 0},
		{"failed", "", `{}`, 40, 10},
	} {
		id := resource.ID()
		if sample.usage != "" {
			exec(t, s, `INSERT INTO billing_transactions(id,user_id,account_id,category,resource_id,item_name,user_name,user_email,mode,status,reserve,pricing,usage)
				VALUES($1,$2,$3,'model',$4,'统计模型','统计用户','stats@example.com','local','unknown',0,'{}',$5)`, id, user, account, model, sample.usage)
		}
		exec(t, s, `INSERT INTO model_calls(id,user_id,model_id,status,error_code,started_at,completed_at,input_tokens,cached_input_tokens,output_tokens,cache_hit)
			VALUES($1,$2,$3,$4,nullif($5,''),$6,$7,$8,$9,$10,$9::bigint>0)`, id, user, model, sample.status, sample.code, now.Add(-2*time.Minute), now.Add(-time.Minute), sample.input, sample.cached, sample.input/10)
	}
	call(t, s, user, model, "failed", now.Add(-26*time.Hour), now.Add(-25*time.Hour), 50, 10, 5, nil)
	call(t, s, user, model, "failed", now.Add(-27*time.Hour), now.Add(-26*time.Hour), 4000, 0, 400, nil)
	exec(t, s, `UPDATE model_calls SET error_code='usage_unknown' WHERE input_tokens=4000`)
	out := request(t, s, "/statistics/models/overview", 200)
	for _, row := range []map[string]any{out["last_24h"].(map[string]any), out["days"].([]any)[89].(map[string]any)} {
		number(t, row, "input_tokens", 100)
		number(t, row, "output_tokens", 10)
		number(t, row, "model_calls", 7)
	}
	previous := out["previous_24h"].(map[string]any)
	number(t, previous, "input_tokens", 50)
	number(t, previous, "output_tokens", 5)
	number(t, previous, "model_calls", 2)
	quality := out["last_30m"].(map[string]any)
	number(t, quality, "tpm", 110.0/30)
	number(t, quality, "rpm", 7.0/30)
	number(t, quality, "model_success_rate", 100.0/7)
	realtime := request(t, s, "/statistics/realtime?range=15m", 200)
	number(t, realtime, "input_tokens", 100)
	number(t, realtime, "output_tokens", 10)
	number(t, realtime, "tpm", 110.0/15)
	number(t, realtime, "model_calls", 7)
	number(t, realtime, "model_success_rate", 100.0/7)
}
