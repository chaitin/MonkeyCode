package stats

import (
	_ "embed"
	"encoding/json"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

//go:embed testdata/modelsoverview.sql
var rawModelsOverview string

func assertHourlyFacts(t *testing.T, s *Service) {
	t.Helper()
	var drift bool
	err := s.pool.QueryRow(t.Context(), `WITH facts AS (
        SELECT date_trunc('hour',c.completed_at,'UTC') AS hour_start,c.model_id,count(*) AS calls,
            count(*) FILTER (WHERE c.status='succeeded') AS succeeded,count(*) FILTER (WHERE c.cache_hit) AS cache_hits,
            coalesce(sum(c.input_tokens) FILTER (WHERE coalesce((b.usage->>'known')::boolean,coalesce(c.error_code,'')='')),0) AS input_tokens,
            coalesce(sum(c.output_tokens) FILTER (WHERE coalesce((b.usage->>'known')::boolean,coalesce(c.error_code,'')='')),0) AS output_tokens
        FROM model_calls c LEFT JOIN billing_transactions b ON b.id=c.id
        WHERE c.completed_at IS NOT NULL AND c.status<>'running' GROUP BY 1,2
    ) SELECT EXISTS (
        SELECT 1 FROM facts f FULL JOIN stats_model_hourly h USING(hour_start,model_id)
        WHERE ROW(coalesce(f.calls,0),coalesce(f.succeeded,0),coalesce(f.cache_hits,0),coalesce(f.input_tokens,0),coalesce(f.output_tokens,0))
            IS DISTINCT FROM ROW(coalesce(h.calls,0),coalesce(h.succeeded,0),coalesce(h.cache_hits,0),coalesce(h.input_tokens,0),coalesce(h.output_tokens,0))
    ) OR EXISTS (
        SELECT 1 FROM model_calls c LEFT JOIN billing_transactions b ON b.id=c.id
        WHERE c.usage_known IS DISTINCT FROM coalesce((b.usage->>'known')::boolean,coalesce(c.error_code,'')='')
    ) OR EXISTS (
        SELECT 1 FROM (SELECT date_trunc('hour',occurred_at,'UTC') AS hour_start,-sum(credit_delta) AS credits
            FROM credit_ledger_entries WHERE category='model' AND entry_type IN ('charge','refund') GROUP BY 1) f
        FULL JOIN stats_model_credit_hourly h USING(hour_start)
        WHERE coalesce(f.credits,0) IS DISTINCT FROM coalesce(h.credits,0)
    )`).Scan(&drift)
	if err != nil || drift {
		t.Fatalf("小时汇总与原始事实不一致: drift=%v err=%v", drift, err)
	}
}

func assertHourlyOverview(t *testing.T, s *Service) {
	t.Helper()
	var data []byte
	if err := s.pool.QueryRow(t.Context(), rawModelsOverview, s.now()).Scan(&data); err != nil {
		t.Fatal(err)
	}
	var expected resource.Object
	if err := json.Unmarshal(data, &expected); err != nil {
		t.Fatal(err)
	}
	actual := request(t, s, "/statistics/models/overview", 200)
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("汇总接口改变统计口径\nactual=%v\nexpected=%v", actual, expected)
	}
	assertHourlyFacts(t, s)
}

func hourlyAccount(t *testing.T, s *Service, user string) string {
	t.Helper()
	id := resource.ID()
	exec(t, s, `INSERT INTO credit_accounts(id,user_id,period_start_at,period_end_at,last_refreshed_at) VALUES($1,$2,$3,$4,$3)`, id, user, s.now().Add(-time.Hour), s.now().Add(time.Hour))
	return id
}

func TestHourlyModelCorrections(t *testing.T) {
	s, user, model := fixture(t)
	account := hourlyAccount(t, s, user)
	id := resource.ID()
	exec(t, s, `INSERT INTO billing_transactions(id,user_id,account_id,category,resource_id,item_name,user_name,user_email,mode,status,reserve,pricing,usage)
        VALUES($1,$2,$3,'model',$4,'模型','统计用户','stats@example.com','local','unknown',0,'{}','{"known":false}')`, id, user, account, model)
	exec(t, s, `INSERT INTO model_calls(id,user_id,model_id,status,started_at,input_tokens,output_tokens) VALUES($1,$2,$3,'running',$4,100,10)`, id, user, model, s.now().Add(-3*time.Hour))
	assertHourlyOverview(t, s)
	exec(t, s, `UPDATE model_calls SET status='succeeded',completed_at=$2 WHERE id=$1`, id, s.now().Add(-90*time.Minute))
	assertHourlyOverview(t, s)
	for _, usage := range []string{`{"known":true}`, `{"known":true}`, `{"known":false}`, `{}`} {
		exec(t, s, `UPDATE billing_transactions SET usage=$2 WHERE id=$1`, id, usage)
		assertHourlyOverview(t, s)
	}
	exec(t, s, `UPDATE model_calls SET input_tokens=200,output_tokens=20,cache_hit=true WHERE id=$1`, id)
	assertHourlyOverview(t, s)
	other := resource.ID()
	exec(t, s, `INSERT INTO models(id,ownership_type,display_name,model_id,protocol,base_url,api_key,advanced_config,owner_user_id) VALUES($1,'system','另一模型','other','openai_chat_completions','https://example.com','test','{}',$2)`, other, user)
	exec(t, s, `UPDATE model_calls SET model_id=$2,status='failed',error_code='usage_unknown',completed_at=$3 WHERE id=$1`, id, other, s.now().Add(-10*time.Minute))
	assertHourlyOverview(t, s)
	exec(t, s, `UPDATE billing_transactions SET usage='{"known":true}' WHERE id=$1`, id)
	assertHourlyOverview(t, s)
	tx, err := s.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context())
	if _, err = tx.Exec(t.Context(), `UPDATE model_calls SET input_tokens=9999,completed_at=$2 WHERE id=$1`, id, s.now().Add(-2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(t.Context(), `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,occurred_at) VALUES($1,$2,'charge','model','回滚交易',-9,0,$3)`, account, user, s.now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	// Readers must see the old facts and projection together until commit.
	assertHourlyOverview(t, s)
	if err = tx.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}
	assertHourlyOverview(t, s)
	exec(t, s, `UPDATE model_calls SET status='running',completed_at=NULL WHERE id=$1`, id)
	assertHourlyOverview(t, s)
	exec(t, s, `UPDATE model_calls SET status='cancelled',completed_at=$2 WHERE id=$1`, id, s.now().Add(-time.Minute))
	assertHourlyOverview(t, s)
	exec(t, s, `DELETE FROM billing_transactions WHERE id=$1`, id)
	assertHourlyOverview(t, s)
	exec(t, s, `DELETE FROM model_calls WHERE id=$1`, id)
	assertHourlyOverview(t, s)
}

func TestHourlyOverviewWindowEdges(t *testing.T) {
	for _, at := range []time.Time{
		time.Date(2026, 9, 8, 12, 34, 56, 123456000, time.UTC),
		time.Date(2026, 9, 8, 12, 0, 0, 0, time.UTC),
		time.Date(2026, 9, 8, 12, 1, 0, 0, time.UTC),
		time.Date(2026, 9, 8, 12, 29, 59, 0, time.UTC),
		time.Date(2026, 9, 8, 12, 30, 0, 0, time.UTC),
		time.Date(2026, 9, 8, 12, 59, 59, 0, time.UTC),
		time.Date(2026, 9, 8, 16, 0, 0, 0, time.UTC),
	} {
		t.Run(at.Format(time.RFC3339Nano), func(t *testing.T) {
			s, user, model := fixture(t)
			s.now = func() time.Time { return at }
			account := hourlyAccount(t, s, user)
			shanghai, _ := time.LoadLocation("Asia/Shanghai")
			local := at.In(shanghai)
			firstDay := time.Date(local.Year(), local.Month(), local.Day()-89, 0, 0, 0, 0, shanghai)
			times := []time.Time{firstDay.Add(-time.Microsecond), firstDay, firstDay.Add(time.Microsecond), at.Truncate(time.Hour), at.Add(-time.Microsecond), at, at.Add(time.Microsecond), at.Add(time.Minute), at.Add(-130 * time.Minute), at.Add(-1510 * time.Minute), at.Add(-2810 * time.Minute)}
			for _, delta := range []time.Duration{48 * time.Hour, 24 * time.Hour, 30 * time.Minute} {
				boundary := at.Add(-delta)
				times = append(times, boundary.Add(-time.Microsecond), boundary, boundary.Add(time.Microsecond))
			}
			for i, end := range times {
				status := []string{"succeeded", "failed", "cancelled", "running"}[i%4]
				id := resource.ID()
				var first any
				if i%2 == 0 {
					first = 100
				}
				exec(t, s, `INSERT INTO model_calls(id,user_id,model_id,status,error_code,started_at,completed_at,input_tokens,output_tokens,cache_hit,first_token_duration_ms)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, id, user, model, status, []string{"", "usage_unknown"}[i%2], end.Add(-time.Second), end, (i+1)*10, i+1, i%3 == 0, first)
				kind := "charge"
				amount := "-1.234567"
				if i%3 == 0 {
					kind = "refund"
					amount = "2.000001"
				}
				exec(t, s, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,occurred_at,event_key)
                    VALUES($1,$2,$3,'model','边界交易',$4,0,$5,$6)`, account, user, kind, amount, end, "hourly-event-"+id)
			}
			// A late refund is attributed to ledger time; duplicate event delivery adds nothing.
			for range 2 {
				exec(t, s, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,occurred_at,event_key)
                VALUES($1,$2,'refund','model','延迟退款',5.000001,0,$3,'late-refund') ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING`, account, user, at.Add(-time.Minute))
			}
			exec(t, s, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,occurred_at) VALUES($1,$2,'charge','tool','非模型费用',-999,0,$3)`, account, user, at.Add(-time.Minute))
			assertHourlyOverview(t, s)
		})
	}
}

func TestHourlyConcurrentCalls(t *testing.T) {
	s, user, model := fixture(t)
	const workers = 8
	const calls = 20
	var wg sync.WaitGroup
	failures := make(chan error, workers)
	for range workers {
		wg.Go(func() {
			for range calls {
				_, err := s.pool.Exec(t.Context(), `INSERT INTO model_calls(user_id,model_id,status,started_at,completed_at,input_tokens,output_tokens) VALUES($1,$2,'succeeded',$3,$4,100,10)`, user, model, s.now().Add(-2*time.Minute), s.now().Add(-time.Minute))
				if err != nil {
					failures <- err
					return
				}
			}
		})
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	assertHourlyOverview(t, s)
	out := request(t, s, "/statistics/models/overview", 200)
	number(t, out["last_24h"].(map[string]any), "model_calls", workers*calls)
}

func TestHourlyMigrationBackfill(t *testing.T) {
	s, user, model := fixture(t)
	account := hourlyAccount(t, s, user)
	call(t, s, user, model, "succeeded", s.now().Add(-48*time.Hour), s.now().Add(-47*time.Hour), 100, 0, 10, nil)
	id := resource.ID()
	exec(t, s, `INSERT INTO billing_transactions(id,user_id,account_id,category,resource_id,item_name,user_name,user_email,mode,status,reserve,pricing,usage)
        VALUES($1,$2,$3,'model',$4,'未知用量','统计用户','stats@example.com','local','unknown',0,'{}','{"known":false}')`, id, user, account, model)
	exec(t, s, `INSERT INTO model_calls(id,user_id,model_id,status,started_at,completed_at,input_tokens,output_tokens) VALUES($1,$2,$3,'succeeded',$4,$5,9999,999)`, id, user, model, s.now().Add(-3*time.Minute), s.now().Add(-2*time.Minute))
	exec(t, s, `INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,occurred_at) VALUES($1,$2,'charge','model','历史费用',-1.234567,0,$3)`, account, user, s.now().Add(-25*time.Hour))
	apply := func(name, direction string) {
		t.Helper()
		data, err := os.ReadFile("../../migrations/" + name + "." + direction + ".sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.pool.Exec(t.Context(), string(data)); err != nil {
			t.Fatal(err)
		}
	}
	// The newer partition migration owns views of usage_known; remove those
	// dependencies before testing removal/recreation of the older column.
	apply("000032_billing_activity_weekly", "down")
	for range 2 {
		for _, direction := range []string{"down", "up"} {
			apply("000028_stats_model_hourly", direction)
		}
		assertHourlyOverview(t, s)
	}
	apply("000032_billing_activity_weekly", "up")
	assertHourlyOverview(t, s)
}

func TestHourlyUpsertRetries(t *testing.T) {
	s, user, model := fixture(t)
	first, second := resource.ID(), resource.ID()
	for _, input := range []int{100, 100, 200} {
		exec(t, s, `INSERT INTO model_calls(id,user_id,model_id,status,started_at,completed_at,input_tokens,output_tokens)
            VALUES($1,$2,$3,'succeeded',$4,$5,$6,10)
            ON CONFLICT (id) DO UPDATE SET input_tokens=EXCLUDED.input_tokens`, first, user, model, s.now().Add(-2*time.Minute), s.now().Add(-time.Minute), input)
		assertHourlyOverview(t, s)
	}
	// Both INSERT and UPDATE statement triggers fire for a mixed upsert.
	exec(t, s, `INSERT INTO model_calls(id,user_id,model_id,status,started_at,completed_at,input_tokens,output_tokens)
        VALUES($1,$3,$4,'succeeded',$5,$6,100,10),($2,$3,$4,'succeeded',$5,$6,50,5)
        ON CONFLICT (id) DO UPDATE SET input_tokens=EXCLUDED.input_tokens`, first, second, user, model, s.now().Add(-2*time.Minute), s.now().Add(-time.Minute))
	assertHourlyOverview(t, s)
	exec(t, s, `INSERT INTO model_calls(id,user_id,model_id,status,started_at,completed_at,input_tokens,output_tokens)
        VALUES($1,$2,$3,'succeeded',$4,$5,999,99) ON CONFLICT (id) DO NOTHING`, first, user, model, s.now().Add(-2*time.Minute), s.now().Add(-time.Minute))
	assertHourlyOverview(t, s)
	out := request(t, s, "/statistics/models/overview", 200)["last_24h"].(map[string]any)
	number(t, out, "model_calls", 2)
	number(t, out, "input_tokens", 150)
}

func TestHourlyBillingBatchCorrections(t *testing.T) {
	s, user, model := fixture(t)
	account := hourlyAccount(t, s, user)
	for i := range 20 {
		end := s.now().Add(-time.Duration(i+1) * time.Hour)
		call(t, s, user, model, "succeeded", end.Add(-time.Minute), end, 100, 0, 10, nil)
	}
	exec(t, s, `INSERT INTO billing_transactions(id,user_id,account_id,category,resource_id,item_name,user_name,user_email,mode,status,reserve,pricing,usage)
        SELECT id,user_id,$1,'model',model_id,'批量用量','统计用户','stats@example.com','local','unknown',0,'{}','{"known":false}' FROM model_calls`, account)
	assertHourlyOverview(t, s)
	exec(t, s, `UPDATE billing_transactions SET usage='{"known":true}'`)
	assertHourlyOverview(t, s)
	var before, after string
	if err := s.pool.QueryRow(t.Context(), `SELECT string_agg(ctid::text,',' ORDER BY id) FROM model_calls`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	exec(t, s, `UPDATE billing_transactions SET usage='{"known":true,"input":999}'`)
	if err := s.pool.QueryRow(t.Context(), `SELECT string_agg(ctid::text,',' ORDER BY id) FROM model_calls`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("用量明确标记未改变时不应重复改写调用行")
	}
	exec(t, s, `UPDATE billing_transactions SET usage='{"known":false}'`)
	assertHourlyOverview(t, s)
	exec(t, s, `DELETE FROM billing_transactions`)
	assertHourlyOverview(t, s)
}
