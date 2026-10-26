package billing

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	imagesqlc "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestActivityWeeklyRemoteAfterObservation(t *testing.T) {
	s, user, model := fixture(t)
	activityCutover(t, s)
	ledgerExec(t, s, `SELECT billing_finish_activity_observation()`)
	ledgerCutover(t, s)
	var dangling int
	if err := s.pool.QueryRow(t.Context(), `SELECT count(*) FROM pg_constraint WHERE contype='f' AND confrelid=(SELECT source_relation FROM billing_activity_partition_state WHERE table_name='billing_transactions')`).Scan(&dangling); err != nil || dangling != 0 {
		t.Fatalf("还有外键指向旧交易表: %d %v", dangling, err)
	}
	stub := &walletStub{failConfirm: true}
	s.WithWallet(&Wallet{Client: stub, BaseURL: "https://baizhiyun.vip", AppID: 4})
	addWalletIdentity(t, s, user, "1001")
	if err := s.BindWallet(t.Context(), user, user, "1001"); err != nil {
		t.Fatal(err)
	}
	p := defaultPolicy()
	p.Enabled = true
	p.Mode = "remote"
	setPolicy(t, s, p)
	r, err := s.Begin(t.Context(), Request{UserID: user, ResourceID: model, Category: "model"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Start(t.Context(), r.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Finish(t.Context(), r.ID, Usage{Input: 10000, Cached: 4000, Output: 2000, Known: true, Result: "succeeded"}); err == nil {
		t.Fatal("确认失败应保留待结算")
	}
	stub.failConfirm = false
	for range 3 {
		if err = s.Settle(t.Context(), r.ID); err != nil {
			t.Fatal(err)
		}
	}
	if len(stub.creates) != 1 || len(stub.confirms) != 2 || stub.creates[0] != stub.confirms[1] {
		t.Fatalf("远程重试不幂等: %+v", stub)
	}
	activityAssert(t, s, false)
	ledgerAssert(t, s)
}

func TestActivityWeeklyLateImageAndVideoUpserts(t *testing.T) {
	s, user, model := fixture(t)
	ids := activitySeed(t, s, user, model, s.now())
	activityCutover(t, s)
	// Existing image billing and job rows can have different week boundaries.
	job := resource.ID()
	ledgerExec(t, s, `INSERT INTO image_jobs(id,user_id,model_id,billing_transaction_id,provider,operation,status,request_hash,requested_images,generated_images,quality,aspect_ratio,created_at,completed_at)
 VALUES($1,$2,$3,$4,'openai','generate','succeeded','late',1,1,'standard','1:1',$5,$6)`, job, user, model, ids["billing_transactions"], s.now().Add(-7*24*time.Hour), s.now())
	// Reuse the preexisting image identity and bind its late job metadata.
	ledgerExec(t, s, `UPDATE image_calls SET id=id WHERE id=$1`, ids["image_calls"])
	ledgerExec(t, s, `DELETE FROM image_calls WHERE id=$1`, ids["image_calls"])
	ledgerExec(t, s, `INSERT INTO image_calls(id,user_id,model_id,billing_transaction_id,status,generated_images,started_at,completed_at) VALUES($1,$2,$3,$1,'succeeded',1,$4,$4::timestamptz+interval '1 minute')`, ids["billing_transactions"], user, model, s.now())
	for range 3 {
		if n, err := imagesqlc.New(s.pool).LinkImageCall(t.Context(), job); err != nil || n != 1 {
			t.Fatalf("跨周生图幂等更新: %d %v", n, err)
		}
		if err := sqlc.New(s.pool).UpsertVideoCall(t.Context(), sqlc.UpsertVideoCallParams{TransactionID: ids["billing_transactions"], Result: "succeeded", DurationMs: 2000}); err != nil {
			t.Fatal(err)
		}
	}
	var at time.Time
	if err := s.pool.QueryRow(t.Context(), `SELECT started_at FROM image_calls WHERE id=$1`, ids["billing_transactions"]).Scan(&at); err != nil || !at.Equal(s.now()) {
		t.Fatalf("任务补齐改变了已登记的开始时间: %v %v", at, err)
	}
	activityAssert(t, s, true)
}

func TestActivityWeeklyRefund(t *testing.T) {
	s, user, model := fixture(t)
	activityCutover(t, s)
	ledgerCutover(t, s)
	r, err := s.Begin(t.Context(), Request{UserID: user, ResourceID: model, Category: "model"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Start(t.Context(), r.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Finish(t.Context(), r.ID, Usage{Input: 10000, Cached: 4000, Output: 2000, Known: true, Result: "succeeded"}); err != nil {
		t.Fatal(err)
	}
	token := resource.ID()
	ledgerExec(t, s, `INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, fmt.Sprintf("%x", sha256.Sum256([]byte(token))), user)
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	handler := identity.NewService(s.pool, nil, "http://example.test").RequireAdmin(router)
	for range 2 {
		req := httptest.NewRequest(http.MethodPost, "/billing/transactions/"+r.ID+"/refund", strings.NewReader(`{"reason":"分区后退款回归"}`))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: token})
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatalf("退款失败: %d %s", w.Code, w.Body)
		}
	}
	var n int
	if err = s.pool.QueryRow(t.Context(), `SELECT count(*) FROM credit_ledger_entries WHERE transaction_id=$1 AND entry_type='refund'`, r.ID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("重复退款: %d %v", n, err)
	}
	a, err := s.Account(t.Context(), user)
	if err != nil || a.Balance != amountText("10000") {
		t.Fatal(a, err)
	}
	activityAssert(t, s, true)
	ledgerAssert(t, s)
}

func TestActivityWeeklyConcurrentCutover(t *testing.T) {
	s, user, model := fixture(t)
	ids := activitySeed(t, s, user, model, s.now())
	ledgerExec(t, s, `SELECT billing_copy_activity_batch('billing_transactions',1000)`)
	ledgerExec(t, s, `SELECT billing_cutover_activity('billing_transactions')`)
	ledgerExec(t, s, `SELECT billing_copy_activity_batch('model_calls',1000)`)
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		for range 100 {
			if _, err := s.pool.Exec(ctx, `UPDATE model_calls SET input_tokens=input_tokens+1 WHERE id=$1`, ids["model_calls"]); err != nil {
				done <- err
				return
			}
		}
		done <- nil
	}()
	ready := false
	for !ready && ctx.Err() == nil {
		err := s.pool.QueryRow(ctx, `SELECT billing_cutover_activity('model_calls')`).Scan(&ready)
		if err != nil {
			if pgErr, ok := err.(*pgconn.PgError); !ok || pgErr.Code != "55P03" {
				t.Fatal(err)
			}
		}
		if !ready {
			time.Sleep(time.Millisecond)
		}
	}
	if !ready {
		t.Fatal("并发切换超时")
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	activityCutover(t, s)
	activityAssert(t, s, true)
	var n int
	if err := s.pool.QueryRow(t.Context(), `SELECT input_tokens FROM model_calls WHERE id=$1`, ids["model_calls"]).Scan(&n); err != nil || n != 200 {
		t.Fatalf("并发更新丢失: %d %v", n, err)
	}
}
