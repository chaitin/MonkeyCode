package relay

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

func TestMetricsSurviveLoggingSafetyFilter(t *testing.T) {
	s := &Service{}
	budget := newDataBudget(&s.metrics)
	permit := budget.reserve(true, false, func() {})
	defer permit.release()
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug}))
	logging.Event(t.Context(), logger, slog.LevelDebug, "relay.stream.completed", "远程代理流结束",
		"operation", "terminal", "route", "/api/v1/endpoints/{machine}/proxy/terminal",
		"metrics", s.metricValues(), "remaining_budget", slog.GroupValue(slog.Int("regular", 1), slog.Int("terminal", 1)))
	var event struct {
		Operation string           `json:"operation"`
		Route     string           `json:"route"`
		Metrics   map[string]int64 `json:"metrics"`
		Budget    map[string]int   `json:"remaining_budget"`
	}
	if err := json.Unmarshal(output.Bytes(), &event); err != nil {
		t.Fatal(err)
	}
	if event.Operation != "terminal" || event.Route != "/api/v1/endpoints/{machine}/proxy/terminal" || event.Metrics["regular_terminal_streams"] != 1 || event.Budget["terminal"] != 1 {
		t.Fatalf("终端诊断被安全过滤器丢弃: %s", output.String())
	}
}
