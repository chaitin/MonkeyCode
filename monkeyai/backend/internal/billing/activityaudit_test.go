package billing

import (
	"errors"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestActivityAuditIgnoredInsertDoesNotLeakIdentity(t *testing.T) {
	s, user, model := fixture(t)
	a, err := s.Account(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	activityMigration(t, s, "down")
	original, ignored := resource.ID(), resource.ID()
	ledgerExec(t, s, `INSERT INTO billing_transactions(id,user_id,account_id,category,resource_id,item_name,user_name,user_email,mode,status,reserve,pricing,idempotency_key) VALUES($1,$2,$3,'model',$4,'test','name','mail','local','reserved',0,'{}','ignored-key')`, original, user, a.ID, model)
	activityMigration(t, s, "up")
	_, err = s.pool.Exec(t.Context(), `UPDATE billing_transactions SET idempotency_key='changed-key' WHERE id=$1`, original)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("未回填交易的原幂等身份仍应受保护: %v", err)
	}
	ledgerExec(t, s, `INSERT INTO billing_transactions(id,user_id,account_id,category,resource_id,item_name,user_name,user_email,mode,status,reserve,pricing,idempotency_key) VALUES($1,$2,$3,'model',$4,'test','name','mail','local','reserved',0,'{}','ignored-key') ON CONFLICT DO NOTHING`, ignored, user, a.ID, model)
	var count int
	if err = s.pool.QueryRow(t.Context(), `SELECT count(*) FROM billing_transactions_keys WHERE id=$1`, ignored).Scan(&count); err != nil || count != 0 {
		t.Fatalf("忽略的 INSERT 不应留下登记: %d %v", count, err)
	}
	activityCutover(t, s)
	activityAssert(t, s, true)
}

func TestActivityAuditOldSnapshotRecognizesCutover(t *testing.T) {
	s, _, _ := fixture(t)
	tx, err := s.pool.BeginTx(t.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context())
	var before bool
	if err = tx.QueryRow(t.Context(), `SELECT billing_activity_backfilling('model_calls')`).Scan(&before); err != nil || !before {
		t.Fatal(before, err)
	}
	activityCutover(t, s)
	var phase string
	var backfilling bool
	if err = tx.QueryRow(t.Context(), `SELECT phase,billing_activity_backfilling(table_name) FROM billing_activity_partition_state WHERE table_name='model_calls'`).Scan(&phase, &backfilling); err != nil || phase != "backfill" || backfilling {
		t.Fatalf("旧快照不应把已切换的旧副本当作权威来源: %s %v %v", phase, backfilling, err)
	}
}

func TestActivityAuditDeletedTransactionCannotBeReseeded(t *testing.T) {
	s, user, model := fixture(t)
	r, err := s.Begin(t.Context(), Request{UserID: user, ResourceID: model, Category: "model"})
	if err != nil {
		t.Fatal(err)
	}
	activityCutover(t, s)
	ledgerExec(t, s, `SELECT billing_finish_activity_observation()`)
	ledgerExec(t, s, `DELETE FROM billing_transactions WHERE id=$1`, r.ID)
	_, err = s.pool.Exec(t.Context(), `INSERT INTO image_calls(id,user_id,model_id,billing_transaction_id,status,started_at) VALUES($1,$2,$3,$4,'succeeded',$5)`, resource.ID(), user, model, r.ID, s.now())
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23503" {
		t.Fatalf("已删除的交易必须保持外键不可引用，不能用旧副本补回登记: %v", err)
	}
	var n int
	if err = s.pool.QueryRow(t.Context(), `SELECT count(*) FROM billing_transactions_keys WHERE id=$1`, r.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("已删除交易的登记被旧副本恢复: %d %v", n, err)
	}
	activityAssert(t, s, false)
}

func TestActivityAuditDeletedIdentityDoesNotReadLegacyTime(t *testing.T) {
	s, user, model := fixture(t)
	id := resource.ID()
	ledgerExec(t, s, `INSERT INTO model_calls(id,user_id,model_id,status,started_at) VALUES($1,$2,$3,'running',$4)`, id, user, model, s.now())
	activityCutover(t, s)
	ledgerExec(t, s, `SELECT billing_finish_activity_observation()`)
	ledgerExec(t, s, `DELETE FROM model_calls WHERE id=$1`, id)
	var found *time.Time
	if err := s.pool.QueryRow(t.Context(), `SELECT billing_activity_time('model_calls',$1::uuid)`, id).Scan(&found); err != nil || found != nil {
		t.Fatalf("分区切换后不能从旧快照返回已删除身份: %v %v", found, err)
	}
	// The ordinary-table PK allowed reuse after a physical purge. The stale legacy
	// row must not reserve the deleted ID/time or repopulate its old task metadata.
	ledgerExec(t, s, `INSERT INTO model_calls(id,user_id,model_id,status,started_at) VALUES($1,$2,$3,'running',$4)`, id, user, model, s.now().Add(7*24*time.Hour))
	activityAssert(t, s, false)
}
