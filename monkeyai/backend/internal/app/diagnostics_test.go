package app

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/relay"
)

func TestRelayDiagnostics(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		var runtime *relay.Service
		if enabled {
			runtime = &relay.Service{}
		}
		w := httptest.NewRecorder()
		debugHandler(runtime).ServeHTTP(w, httptest.NewRequest("GET", "/debug/relay", nil))
		if !enabled {
			if w.Code != 404 {
				t.Fatal("关闭中转时仍发布指标")
			}
			continue
		}
		var metrics map[string]int64
		if err := json.Unmarshal(w.Body.Bytes(), &metrics); err != nil || w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("指标响应无效: %s %v", w.Body.String(), err)
		}
		for _, key := range []string{"regular_data_streams", "regular_terminal_streams", "candidate_streams", "limit_rejections", "candidate_timeouts", "candidate_promotions", "stream_open_failures", "revocation_closures", "received_bytes", "sent_bytes"} {
			if _, ok := metrics[key]; !ok {
				t.Fatalf("缺少指标 %s", key)
			}
		}
	}
}
