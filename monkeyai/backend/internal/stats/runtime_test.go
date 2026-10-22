package stats

import (
	"testing"
	"time"
)

func TestRuntimeClientStatistics(t *testing.T) {
	s, user, model := fixture(t)
	for _, clientType := range []string{"runtime", "desktop"} {
		id := clientSession(t, s, user, clientType, "linux")
		clientTurn(t, s, id, 1, s.now().Add(-time.Hour), "complete", "1.0", model)
	}
	checkClientOverview(t, request(t, s, clientOverviewPath, 200), 2, map[string]map[string]int{
		"client_type": {"runtime": 1, "desktop": 1},
	})
	checkClientOverview(t, request(t, s, clientOverviewPath+"?client_type=runtime", 200), 1, map[string]map[string]int{
		"client_type": {"runtime": 1},
	})
	out := request(t, s, "/statistics/session-reporting/clients?client_type=runtime", 200)
	items := out["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("筛选应仅返回 runtime 会话: %v", out)
	}
	item := items[0].(map[string]any)
	if item["client_type"] != "runtime" {
		t.Fatalf("客户端类型丢失: %v", item)
	}
}
