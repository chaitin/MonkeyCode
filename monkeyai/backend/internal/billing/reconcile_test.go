package billing

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

func TestStoppedReconciliationIsObservableAndKeepsUnknown(t *testing.T) {
	s, user, model := fixture(t)
	r, err := s.Begin(t.Context(), Request{UserID: user, ResourceID: model, Category: "model"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Start(t.Context(), r.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Finish(t.Context(), r.ID, Usage{Known: false, Result: "failed", RequestID: "resp-test", ErrorCode: "usage_missing"}); err != nil {
		t.Fatal(err)
	}
	s.WithUsageReconciler(&usageReconcilerStub{result: ReconciliationResult{State: ReconciliationUnsupported, Reason: "upstream_rejected", UpstreamStatus: 401}})
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(logging.New(&logs, slog.LevelDebug))
	defer slog.SetDefault(previous)
	for range 2 {
		if err := s.reconcileUnknown(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
	if strings.Count(logs.String(), `"event":"billing.reconciliation.stopped"`) != 1 || !strings.Contains(logs.String(), `"reason":"upstream_rejected"`) || !strings.Contains(logs.String(), `"upstream_status":401`) {
		t.Fatal(logs.String())
	}
	var status string
	var stopped bool
	if err := s.pool.QueryRow(t.Context(), `SELECT status,next_retry_at IS NULL FROM billing_transactions WHERE id=$1`, r.ID).Scan(&status, &stopped); err != nil {
		t.Fatal(err)
	}
	if status != "unknown" || !stopped {
		t.Fatalf("停止对账不能丢失待核查状态: %s %v", status, stopped)
	}
}
