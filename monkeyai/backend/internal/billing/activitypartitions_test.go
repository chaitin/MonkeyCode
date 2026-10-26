package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func activityMigration(t *testing.T, s *Service, direction string) {
	t.Helper()
	b, err := os.ReadFile("../../migrations/000032_billing_activity_weekly." + direction + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	ledgerExec(t, s, string(b))
}
func activityCutover(t *testing.T, s *Service) {
	t.Helper()
	for _, name := range activityTables {
		for range 100 {
			var n int
			if err := s.pool.QueryRow(t.Context(), `SELECT billing_copy_activity_batch($1,2)`, name).Scan(&n); err != nil {
				t.Fatal(name, err)
			}
			if n <= 0 {
				break
			}
		}
		var ready bool
		if err := s.pool.QueryRow(t.Context(), `SELECT billing_cutover_activity($1)`, name).Scan(&ready); err != nil || !ready {
			t.Fatalf("切换 %s: %v %v", name, ready, err)
		}
	}
}
func activityAssert(t *testing.T, s *Service, mirror bool) {
	t.Helper()
	for _, name := range activityTables {
		var valid bool
		query := fmt.Sprintf(`SELECT (SELECT count(*) FROM %s)=(SELECT count(*) FROM %s_keys)`, name, name)
		if mirror {
			query += fmt.Sprintf(` AND NOT EXISTS(SELECT 1 FROM %s a FULL JOIN %s_legacy b USING(id) WHERE to_jsonb(a) IS DISTINCT FROM to_jsonb(b))`, name, name)
		}
		if err := s.pool.QueryRow(t.Context(), query).Scan(&valid); err != nil || !valid {
			t.Fatalf("表/登记/镜像 %s: %v %v", name, valid, err)
		}
	}
	var valid bool
	if err := s.pool.QueryRow(t.Context(), `SELECT
 (SELECT coalesce(sum(calls),0) FROM stats_model_hourly)=(SELECT count(*) FROM model_calls WHERE completed_at IS NOT NULL AND status<>'running')
 AND (SELECT coalesce(sum(input_tokens),0) FROM stats_model_hourly)=(SELECT coalesce(sum(input_tokens) FILTER(WHERE usage_known),0) FROM model_calls WHERE completed_at IS NOT NULL AND status<>'running')
 AND (SELECT coalesce(sum(output_tokens),0) FROM stats_model_hourly)=(SELECT coalesce(sum(output_tokens) FILTER(WHERE usage_known),0) FROM model_calls WHERE completed_at IS NOT NULL AND status<>'running')`).Scan(&valid); err != nil || !valid {
		t.Fatalf("小时投影重复或遗漏: %v %v", valid, err)
	}
}

// Populate all five relation shapes, including every globally unique task key.
func activitySeed(t *testing.T, s *Service, user, model string, at time.Time) map[string]string {
	t.Helper()
	a, err := s.Account(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{}
	for _, name := range activityTables {
		ids[name] = resource.ID()
	}
	connector, tool, job := resource.ID(), resource.ID(), resource.ID()
	ledgerExec(t, s, `INSERT INTO connectors(id,owner_user_id,name,url,authorization_mode,authorization_method) VALUES($1,$2,concat('周分区工具-',gen_random_uuid()),'https://example.com','centralized','http_header')`, connector, user)
	ledgerExec(t, s, `INSERT INTO mcp_tools(id,connector_id,name,enabled,credits_per_call,config_revision) VALUES($1,$2,'weekly',true,1,1)`, tool, connector)
	ledgerExec(t, s, `INSERT INTO billing_transactions(id,user_id,account_id,category,resource_id,item_name,user_name,user_email,mode,status,reserve,pricing,usage,idempotency_key,started_at)
 VALUES($1,$2,$3,'model',$4,'weekly','name','weekly@example.com','local','settled',10,'{}','{"known":true}',$5,$6)`, ids["billing_transactions"], user, a.ID, model, ids["billing_transactions"], at)
	ledgerExec(t, s, `INSERT INTO model_calls(id,user_id,model_id,status,input_tokens,output_tokens,started_at,completed_at) VALUES($1,$2,$3,'succeeded',100,10,$4,$4::timestamptz+interval '1 minute')`, ids["model_calls"], user, model, at)
	ledgerExec(t, s, `INSERT INTO mcp_tool_calls(id,user_id,connector_id,tool_id,status,started_at,completed_at) VALUES($1,$2,$3,$4,'succeeded',$5,$5::timestamptz+interval '1 minute')`, ids["mcp_tool_calls"], user, connector, tool, at)
	ledgerExec(t, s, `INSERT INTO image_calls(id,user_id,model_id,billing_transaction_id,status,generated_images,started_at,completed_at) VALUES($1,$2,$3,$4,'succeeded',1,$5,$5::timestamptz+interval '1 minute')`, ids["image_calls"], user, model, ids["billing_transactions"], at)
	ledgerExec(t, s, `INSERT INTO video_jobs(id,user_id,model_id,provider,mode,status,request_hash,request_config,pricing_snapshot,billing_transaction_id,created_at)
 VALUES($1,$2,$3,'openai','text-to-video','succeeded','weekly','{}','{}',$4,$5)`, job, user, model, ids["billing_transactions"], at)
	ledgerExec(t, s, `INSERT INTO video_calls(id,job_id,billing_transaction_id,user_id,model_id,status,output_duration_ms,created_at) VALUES($1,$2,$3,$4,$5,'succeeded',1000,$6)`, ids["video_calls"], job, ids["billing_transactions"], user, model, at)
	return ids
}

func TestActivityWeeklyMigrationAndRollback(t *testing.T) {
	s, user, model := fixture(t)
	if _, err := s.Account(t.Context(), user); err != nil {
		t.Fatal(err)
	}
	activityMigration(t, s, "down")
	at := time.Date(2026, 12, 28, 0, 0, 0, 0, time.FixedZone("Shanghai", 8*3600))
	ids := activitySeed(t, s, user, model, at)
	sunday := activitySeed(t, s, user, model, at.Add(-time.Microsecond))
	activityMigration(t, s, "up")
	// Historical rows can change or disappear before their backfill batch arrives.
	ledgerExec(t, s, `UPDATE model_calls SET input_tokens=200 WHERE id=$1`, ids["model_calls"])
	ledgerExec(t, s, `DELETE FROM mcp_tool_calls WHERE id=$1`, sunday["mcp_tool_calls"])
	activityCutover(t, s)
	activityAssert(t, s, true)
	for _, name := range activityTables {
		var actual string
		if err := s.pool.QueryRow(t.Context(), fmt.Sprintf(`SELECT tableoid::regclass::text FROM %s WHERE id=$1`, name), ids[name]).Scan(&actual); err != nil || actual != name+"_20261228" {
			t.Fatalf("周一边界 %s: %s %v", name, actual, err)
		}
		if name != "mcp_tool_calls" {
			if err := s.pool.QueryRow(t.Context(), fmt.Sprintf(`SELECT tableoid::regclass::text FROM %s WHERE id=$1`, name), sunday[name]).Scan(&actual); err != nil || actual != name+"_20261221" {
				t.Fatalf("周日前一微秒 %s: %s %v", name, actual, err)
			}
		}
		clock := "started_at"
		if name == "video_calls" {
			clock = "created_at"
		}
		if _, err := s.pool.Exec(t.Context(), fmt.Sprintf(`UPDATE %s SET %s=%s+interval '7 days' WHERE id=$1`, name, clock, clock), ids[name]); err == nil {
			t.Fatal("不能移动全局身份到另一周", name)
		}
	}
	// Billing changes update usage_known in model_calls through nested triggers.
	ledgerExec(t, s, `INSERT INTO model_calls(id,user_id,model_id,status,input_tokens,started_at,completed_at) SELECT id,user_id,resource_id,'succeeded',500,started_at,started_at+interval '1 minute' FROM billing_transactions WHERE id=$1`, ids["billing_transactions"])
	ledgerExec(t, s, `UPDATE billing_transactions SET usage='{"known":false}' WHERE id=$1`, ids["billing_transactions"])
	activityAssert(t, s, true)
	ledgerExec(t, s, `UPDATE billing_transactions SET usage='{"known":true}' WHERE id=$1`, ids["billing_transactions"])
	ledgerExec(t, s, `UPDATE image_calls SET generated_images=3 WHERE id=$1`, ids["image_calls"])
	activityAssert(t, s, true)
	reader, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Rollback(context.Background())
	if _, err = reader.Exec(t.Context(), `SELECT 1 FROM model_calls_legacy LIMIT 1`); err != nil {
		t.Fatal(err)
	}
	var done bool
	if err = s.pool.QueryRow(t.Context(), `SELECT billing_finish_activity_observation()`).Scan(&done); err != nil || done {
		t.Fatalf("观察期结束应无等待地拒绝锁竞争: %v %v", done, err)
	}
	if err = reader.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(t.Context(), `SELECT billing_finish_activity_observation()`).Scan(&done); err != nil || !done {
		t.Fatal(done, err)
	}
	ledgerExec(t, s, `UPDATE image_calls SET generated_images=5 WHERE id=$1`, ids["image_calls"])
	ledgerExec(t, s, `DELETE FROM model_calls WHERE id=$1`, ids["model_calls"])
	ledgerExec(t, s, `DELETE FROM mcp_tool_calls WHERE id=$1`, ids["mcp_tool_calls"])
	activityAssert(t, s, false)
	activityMigration(t, s, "down")
	var images, models, tools int
	if err := s.pool.QueryRow(t.Context(), `SELECT (SELECT generated_images FROM image_calls WHERE id=$1),(SELECT count(*) FROM model_calls WHERE id=$2),(SELECT count(*) FROM mcp_tool_calls WHERE id=$3)`, ids["image_calls"], ids["model_calls"], ids["mcp_tool_calls"]).Scan(&images, &models, &tools); err != nil || images != 5 || models != 0 || tools != 0 {
		t.Fatalf("回滚丢失更新或恢复已清理数据: %d %d %d %v", images, models, tools, err)
	}
	activityMigration(t, s, "up")
	activityCutover(t, s)
	activityAssert(t, s, true)
}

func TestActivityWeeklyDefaultAndGlobalUniqueness(t *testing.T) {
	s, user, model := fixture(t)
	activityCutover(t, s)
	at := time.Date(2031, 1, 6, 3, 0, 0, 0, time.UTC)
	ids := activitySeed(t, s, user, model, at)
	ledgerExec(t, s, `INSERT INTO model_calls(user_id,model_id,status,started_at,completed_at) VALUES($1,$2,'succeeded',$3,$3::timestamptz+interval '1 minute')`, user, model, at.Add(7*24*time.Hour))
	if _, err := s.pool.Exec(t.Context(), `SELECT billing_create_activity_week('model_calls',$1,1)`, at); err == nil {
		t.Fatal("默认分区总量超限应拒绝自动 DDL，即使单周只有一行")
	}
	activityAssert(t, s, true)
	for _, name := range activityTables {
		var actual string
		if err := s.pool.QueryRow(t.Context(), fmt.Sprintf(`SELECT tableoid::regclass::text FROM %s WHERE id=$1`, name), ids[name]).Scan(&actual); err != nil || actual != name+"_default" {
			t.Fatalf("默认分区 %s: %s %v", name, actual, err)
		}
		ledgerExec(t, s, `SELECT billing_create_activity_week($1,$2)`, name, at)
	}
	activityAssert(t, s, true)
	a, err := s.Account(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.pool.Exec(t.Context(), `INSERT INTO billing_transactions(user_id,account_id,category,resource_id,item_name,user_name,user_email,mode,status,reserve,pricing,idempotency_key,started_at)
 VALUES($1,$2,'model',$3,'dup','n','e','local','reserved',1,'{}',$4,$5)`, user, a.ID, model, ids["billing_transactions"], at.Add(7*24*time.Hour)); err == nil {
		t.Fatal("跨周幂等键应全局唯一")
	}
	if _, err = s.pool.Exec(t.Context(), `INSERT INTO model_calls(id,user_id,model_id,status,started_at,completed_at) SELECT id,user_id,model_id,status,started_at+interval '7 days',completed_at+interval '7 days' FROM model_calls WHERE id=$1`, ids["model_calls"]); err == nil {
		t.Fatal("跨周 ID 应全局唯一")
	}
	if _, err = s.pool.Exec(t.Context(), `INSERT INTO video_calls(job_id,billing_transaction_id,user_id,model_id,status,created_at) SELECT job_id,billing_transaction_id,user_id,model_id,status,created_at+interval '7 days' FROM video_calls WHERE id=$1`, ids["video_calls"]); err == nil {
		t.Fatal("跨周任务应全局唯一")
	}
	if _, err = s.pool.Exec(t.Context(), `DELETE FROM billing_transactions WHERE id=$1`, ids["billing_transactions"]); err == nil {
		t.Fatal("钱包/任务/流水等关联应继续阻止删除交易")
	}
	activityAssert(t, s, true)
}

func TestActivityWeeklySettlementAndPruning(t *testing.T) {
	s, user, model := fixture(t)
	// Create while backfilling, execute after cutover, finish in another week.
	r, err := s.Begin(t.Context(), Request{UserID: user, ResourceID: model, Category: "model", IdempotencyKey: "activity-call", RequestHash: "same"})
	if err != nil {
		t.Fatal(err)
	}
	activityCutover(t, s)
	ledgerCutover(t, s)
	if err = s.Start(t.Context(), r.ID); err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return time.Date(2026, 10, 1, 1, 0, 0, 0, time.UTC) }
	for range 3 {
		if err = s.Finish(t.Context(), r.ID, Usage{Input: 10000, Cached: 4000, Output: 2000, Known: true, Result: "succeeded"}); err != nil {
			t.Fatal(err)
		}
	}
	q := sqlc.New(s.pool)
	if _, err = q.IdempotentTransaction(t.Context(), sqlc.IdempotentTransactionParams{UserID: user, Category: "model", IdempotencyKey: func() *string { v := "activity-call"; return &v }()}); err != nil {
		t.Fatal(err)
	}
	var charges int
	if err = s.pool.QueryRow(t.Context(), `SELECT count(*) FROM credit_ledger_entries WHERE transaction_id=$1 AND entry_type='charge'`, r.ID).Scan(&charges); err != nil || charges != 1 {
		t.Fatal(charges, err)
	}
	activityAssert(t, s, true)
	var plan json.RawMessage
	if err = s.pool.QueryRow(t.Context(), `EXPLAIN (ANALYZE,FORMAT JSON) SELECT * FROM billing_transactions WHERE id=$1 AND started_at=(SELECT billing_activity_time('billing_transactions',$1::uuid))`, r.ID).Scan(&plan); err != nil {
		t.Fatal(err)
	}
	var nodes []map[string]any
	if err = json.Unmarshal(plan, &nodes); err != nil {
		t.Fatal(err)
	}
	scans := 0
	var walk func(map[string]any)
	walk = func(node map[string]any) {
		if _, ok := node["Relation Name"]; ok {
			if node["Actual Loops"].(float64) > 0 {
				scans++
			}
		}
		if children, ok := node["Plans"].([]any); ok {
			for _, child := range children {
				walk(child.(map[string]any))
			}
		}
	}
	walk(nodes[0]["Plan"].(map[string]any))
	if scans != 1 {
		t.Fatalf("ID 查询应只访问一个分区，实际 %d: %s", scans, plan)
	}
	// Unknown IDs must also remain safe.
	if _, err = q.TransactionStatus(t.Context(), resource.ID()); err == nil {
		t.Fatal("未知交易不应命中")
	}
}

func TestActivityWeeklyBackfillDeleteRace(t *testing.T) {
	s, user, model := fixture(t)
	if _, err := s.Account(t.Context(), user); err != nil {
		t.Fatal(err)
	}
	activityMigration(t, s, "down")
	ids := activitySeed(t, s, user, model, time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC))
	activityMigration(t, s, "up")
	var done bool
	ledgerExec(t, s, `SELECT billing_copy_activity_batch('billing_transactions',1000)`)
	if err := s.pool.QueryRow(t.Context(), `SELECT billing_cutover_activity('billing_transactions')`).Scan(&done); err != nil || !done {
		t.Fatal(done, err)
	}
	tx, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(t.Context(), `DELETE FROM model_calls WHERE id=$1`, ids["model_calls"]); err != nil {
		t.Fatal(err)
	}
	// A canceled copy waiting for the source row cannot advance its committed cursor.
	ctx, cancel := context.WithTimeout(t.Context(), 150*time.Millisecond)
	_, err = s.pool.Exec(ctx, `SELECT billing_copy_activity_batch('model_calls',1000)`)
	cancel()
	if err == nil {
		t.Fatal("回填应等待并发删除的行锁")
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	activityCutover(t, s)
	activityAssert(t, s, true)
	var n int
	if err = s.pool.QueryRow(t.Context(), `SELECT count(*) FROM model_calls WHERE id=$1`, ids["model_calls"]).Scan(&n); err != nil || n != 0 {
		t.Fatalf("回填恢复了已删除调用: %d %v", n, err)
	}
}

func TestActivityWeeklyWorker(t *testing.T) {
	s, user, model := fixture(t)
	activitySeed(t, s, user, model, s.now())
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() { defer close(done); s.runActivityPartitions(ctx) }()
	defer func() { cancel(); <-done }()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		if err := s.pool.QueryRow(t.Context(), `SELECT count(*) FROM billing_activity_partition_state WHERE phase='partitioned'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n == len(activityTables) {
			activityAssert(t, s, true)
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("后台未完成五张表回填及切换")
}
