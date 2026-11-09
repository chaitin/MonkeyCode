package environment

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
)

func TestRepeatedExchangeCannotAdvanceUsageBillingOrReopenPrices(t *testing.T) {
	s, user, host, at := meterFixture(t, "10000")
	e, err := s.Create(t.Context(), user, Creation{"replay", "replay-create"})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(Exchange{Protocol: 1, Results: []Observation{observe(e.Environment, "running")}})
	stamp := time.Now().UTC()
	if _, err := s.ExchangeAt(t.Context(), host, raw, stamp); err != nil {
		t.Fatal(err)
	}
	*at = at.Add(30 * time.Second)
	stamp = stamp.Add(time.Millisecond)
	if _, err := s.ExchangeAt(t.Context(), host, raw, stamp); err != nil {
		t.Fatal(err)
	}
	*at = at.Add(30 * time.Second)
	if _, err := s.ExchangeAt(t.Context(), host, raw, stamp); err == nil {
		t.Fatal("重复报告被接受")
	}
	settle(t, s, false)
	cost(t, s, user, "30", 1)
	cfg := hostSetup(t, s, host)
	price := BillingConfig{Enabled: true, CPU: 7200_000000}
	if _, err := s.saveSetup(t.Context(), host, Setup{Resource: *cfg.Resource, MaxEnvironments: cfg.MaxEnvironments, UserMaxEnvironments: cfg.UserMaxEnvironments, Billing: &price}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ExchangeAt(t.Context(), host, raw, stamp); err == nil {
		t.Fatal("旧报告可开启新价格时段")
	}
	var periods int
	if err := s.pool.QueryRow(t.Context(), "SELECT count(*) FROM environment_billing_periods WHERE closed_at IS NULL AND environment_id=$1", e.Environment.ID).Scan(&periods); err != nil || periods != 0 {
		t.Fatal("重复报告重开收费", err, periods)
	}
	current, err := sqlc.New(s.pool).GetEnvironment(t.Context(), sqlc.GetEnvironmentParams{ID: e.Environment.ID})
	if err != nil || current.Desired != "running" {
		t.Fatal("拒绝重放改变环境目标", err)
	}
}
