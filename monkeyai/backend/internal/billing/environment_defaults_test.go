package billing

import (
	"bytes"
	"encoding/json"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/memberscope"
	"github.com/go-chi/chi/v5"
	"net/http/httptest"
	"testing"
)

func TestStandalonePolicyPreservesStoredExtension(t *testing.T) {
	p := defaultPolicy()
	raw, _ := json.Marshal(p)
	if bytes.Contains(raw, []byte("environment")) {
		t.Fatal("开源默认策略不应包含云电脑价格")
	}
	if err := json.Unmarshal([]byte(`{"environment":{"cpu_credits_per_core_hour":"123"}}`), &p); err != nil {
		t.Fatal(err)
	}
	p.Revision++
	raw, err := json.Marshal(p)
	if err != nil || !bytes.Contains(raw, []byte(`"cpu_credits_per_core_hour":"123"`)) {
		t.Fatal("普通设置覆盖了扩展定价")
	}
	r := chi.NewRouter()
	NewService(nil).RegisterAdmin(r, memberscope.AdminOnly(r.Get))
	out := httptest.NewRecorder()
	r.ServeHTTP(out, httptest.NewRequest("PATCH", "/billing/settings/environment", nil))
	if out.Code != 404 {
		t.Fatalf("未装配时返回 %d", out.Code)
	}
}
