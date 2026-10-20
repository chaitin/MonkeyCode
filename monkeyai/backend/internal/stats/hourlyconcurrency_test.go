package stats

import (
	"context"
	"testing"
	"time"
)

// A session purge can delete many calls while another call is being reconciled.
// Completion and deletion must finish without deadlock or stale contributions.
func TestHourlyBulkDeleteDuringCompletion(t *testing.T) {
	s, user, model := fixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	first := "00000000-0000-4000-8000-000000000001"
	second := "00000000-0000-4000-8000-000000000002"
	for _, id := range []string{first, second} {
		exec(t, s, `INSERT INTO model_calls(id,user_id,model_id,status,started_at,completed_at,input_tokens,output_tokens)
            VALUES($1,$2,$3,'succeeded',$4,$5,100,10)`, id, user, model, s.now().Add(-2*time.Minute), s.now().Add(-time.Minute))
	}
	// Pause DELETE after its first row, independently of the aggregate triggers.
	exec(t, s, `CREATE FUNCTION test_hourly_pause() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF OLD.id='00000000-0000-4000-8000-000000000001'::uuid THEN
            PERFORM pg_advisory_xact_lock(78123,991); END IF; RETURN NULL; END; $$;
        CREATE TRIGGER zz_test_hourly_pause AFTER DELETE ON model_calls FOR EACH ROW EXECUTE FUNCTION test_hourly_pause();`)
	barrier, err := s.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer barrier.Release()
	if _, err = barrier.Exec(ctx, `SELECT pg_advisory_lock(78123,991)`); err != nil {
		t.Fatal(err)
	}
	defer barrier.Exec(context.Background(), `SELECT pg_advisory_unlock(78123,991)`)
	purge, err := s.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer purge.Release()
	completion, err := s.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer completion.Release()
	purged := make(chan error, 1)
	completed := make(chan error, 1)
	go func() {
		_, err := purge.Exec(ctx, `DELETE FROM model_calls WHERE id=ANY($1::uuid[])`, []string{first, second})
		purged <- err
	}()
	waitLock := func(pid uint32, event string) {
		t.Helper()
		for {
			var waiting bool
			err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock' AND wait_event=$2)`, pid, event).Scan(&waiting)
			if err != nil {
				t.Fatal(err)
			}
			if waiting {
				return
			}
			select {
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			case <-time.After(5 * time.Millisecond):
			}
		}
	}
	waitLock(purge.Conn().PgConn().PID(), "advisory")
	go func() {
		_, err := completion.Exec(ctx, `UPDATE model_calls SET input_tokens=101 WHERE id=$1`, second)
		completed <- err
	}()
	// Completion may wait for the purged call's row lock until DELETE commits.
	var completionErr error
	finished := false
	deadline := time.NewTimer(100 * time.Millisecond)
	select {
	case completionErr = <-completed:
		finished = true
	case <-deadline.C:
	}
	deadline.Stop()
	if _, err = barrier.Exec(ctx, `SELECT pg_advisory_unlock(78123,991)`); err != nil {
		t.Fatal(err)
	}
	if !finished {
		completionErr = <-completed
	}
	purgeErr := <-purged
	if completionErr != nil || purgeErr != nil {
		t.Fatalf("清理与结算不能死锁或丢失更新: completion=%v purge=%v", completionErr, purgeErr)
	}
	assertHourlyOverview(t, s)
}

func TestHourlyConcurrentPurgesLockBucketsInOrder(t *testing.T) {
	s, user, model := fixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 12*time.Second)
	defer cancel()
	ids := []string{"00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012", "00000000-0000-4000-8000-000000000013", "00000000-0000-4000-8000-000000000014"}
	for i, id := range ids {
		hour := time.Hour
		if i == 1 || i == 2 {
			hour = 2 * time.Hour
		}
		end := s.now().Add(-hour - time.Minute)
		exec(t, s, `INSERT INTO model_calls(id,user_id,model_id,status,started_at,completed_at,input_tokens,output_tokens) VALUES($1,$2,$3,'succeeded',$4,$5,100,10)`, id, user, model, end.Add(-time.Minute), end)
	}
	exec(t, s, `CREATE FUNCTION test_hourly_pause_two() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF OLD.id='00000000-0000-4000-8000-000000000011'::uuid THEN PERFORM pg_advisory_xact_lock(78123,992);
        ELSIF OLD.id='00000000-0000-4000-8000-000000000013'::uuid THEN PERFORM pg_advisory_xact_lock(78123,993); END IF; RETURN NULL; END; $$;
        CREATE TRIGGER zz_test_hourly_pause_two AFTER DELETE ON model_calls FOR EACH ROW EXECUTE FUNCTION test_hourly_pause_two();`)
	barrier, err := s.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer barrier.Release()
	if _, err = barrier.Exec(ctx, `SELECT pg_advisory_lock(78123,992); SELECT pg_advisory_lock(78123,993)`); err != nil {
		t.Fatal(err)
	}
	defer barrier.Exec(context.Background(), `SELECT pg_advisory_unlock_all()`)
	left, err := s.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer left.Release()
	right, err := s.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer right.Release()
	results := make(chan error, 2)
	go func() {
		_, err := left.Exec(ctx, `DELETE FROM model_calls WHERE id=ANY($1::uuid[])`, ids[:2])
		results <- err
	}()
	go func() {
		_, err := right.Exec(ctx, `DELETE FROM model_calls WHERE id=ANY($1::uuid[])`, ids[2:])
		results <- err
	}()
	for {
		var count int
		err = s.pool.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity WHERE pid=ANY($1::integer[]) AND wait_event_type='Lock' AND wait_event='advisory'`, []int32{int32(left.Conn().PgConn().PID()), int32(right.Conn().PgConn().PID())}).Scan(&count)
		if err != nil {
			t.Fatal(err)
		}
		if count == 2 {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(5 * time.Millisecond):
		}
	}
	if _, err = barrier.Exec(ctx, `SELECT pg_advisory_unlock_all()`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := <-results; err != nil {
			t.Errorf("并发清理不同会话不能因小时桶锁顺序死锁: %v", err)
		}
	}
	assertHourlyOverview(t, s)
}
