package setting

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"

	"github.com/go-chi/chi/v5"
	"reflect"
	"testing"
)

func TestMCPNetworkSettings(t *testing.T) {
	store := &memoryStore{records: map[string]Record{}}
	s := NewService(store)
	cidrs, err := s.MCPBlockedCIDRs(t.Context())
	if err != nil || len(cidrs) != 0 {
		t.Fatalf("默认黑名单应为空: %v %v", cidrs, err)
	}
	value := json.RawMessage(`{"blocked_cidrs":[" 10.1.2.3/16 ","fd00::1234/8","::ffff:192.168.1.9/120"]}`)
	record, err := s.Put(t.Context(), "mcp", value, 1, "admin")
	if err != nil {
		t.Fatal(err)
	}
	cidrs, err = s.MCPBlockedCIDRs(t.Context())
	want := []netip.Prefix{
		netip.MustParsePrefix("10.1.0.0/16"),
		netip.MustParsePrefix("fd00::/8"),
		netip.MustParsePrefix("192.168.1.0/24"),
	}
	if err != nil || !reflect.DeepEqual(cidrs, want) {
		t.Fatalf("黑名单未正确读取: %v %v", cidrs, err)
	}
	admin, err := s.AdminGet(t.Context(), "mcp")
	if err != nil || string(admin.Value) != string(record.Value) {
		t.Fatalf("管理员应能读取完整配置: %s %v", admin.Value, err)
	}
	config, err := s.AgentConfig(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := config.Settings["mcp"]; ok {
		t.Fatal("服务端网络限制不应下发给客户端")
	}
	for _, value := range []string{
		`{}`, `{"blocked_cidrs":null}`, `{"blocked_cidrs":"10.0.0.0/8"}`,
		`{"blocked_cidrs":[null]}`, `{"blocked_cidrs":[123]}`,
		`{"blocked_cidrs":[""]}`, `{"blocked_cidrs":["10.0.0.1"]}`,
		`{"blocked_cidrs":["10.0.0.0/33"]}`, `{"blocked_cidrs":["fd00::/129"]}`,
		`{"blocked_cidrs":["example.com/24"]}`, `{"blocked_cidrs":["::ffff:0:0/80"]}`,
	} {
		if _, err := s.Put(t.Context(), "mcp", json.RawMessage(value), 1, "admin"); err == nil {
			t.Fatalf("不得接受无效黑名单: %s", value)
		}
		if string(store.records["mcp"].Value) != string(record.Value) {
			t.Fatal("校验失败不应覆盖已保存的黑名单")
		}
	}
	if _, err := s.Put(t.Context(), "mcp", json.RawMessage(`{"blocked_cidrs":[]}`), 1, "admin"); err != nil {
		t.Fatal(err)
	}
	cidrs, err = s.MCPBlockedCIDRs(t.Context())
	if err != nil || len(cidrs) != 0 {
		t.Fatalf("应支持清空黑名单: %v %v", cidrs, err)
	}
}

func TestMCPNetworkAdminSettings(t *testing.T) {
	s := NewService(&memoryStore{records: map[string]Record{}})
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	for _, tc := range []struct {
		body   string
		status int
	}{
		{`{"schema_version":1,"value":{"blocked_cidrs":["10.0.0.0/8","fd00::/8"]}}`, http.StatusOK},
		{`{"schema_version":1,"value":{"blocked_cidrs":["invalid"]}}`, http.StatusBadRequest},
	} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/settings/mcp", strings.NewReader(tc.body)))
		if w.Code != tc.status {
			t.Fatalf("管理接口状态错误: %d %s", w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/settings/mcp", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "10.0.0.0/8") {
		t.Fatalf("应能读取保存成功的黑名单: %d %s", w.Code, w.Body.String())
	}
}

func TestMCPNetworkSettingsFailClosed(t *testing.T) {
	readErr := errors.New("数据库不可用")
	s := NewService(&memoryStore{err: readErr})
	if _, err := s.MCPBlockedCIDRs(t.Context()); !errors.Is(err, readErr) {
		t.Fatalf("不得忽略黑名单读取错误: %v", err)
	}
	for _, value := range []string{`null`, `{}`, `{"blocked_cidrs":["invalid"]}`} {
		s = NewService(&memoryStore{records: map[string]Record{"mcp": {Key: "mcp", Value: json.RawMessage(value)}}})
		if _, err := s.MCPBlockedCIDRs(t.Context()); err == nil {
			t.Fatalf("不得忽略已存储的损坏配置: %s", value)
		}
	}
}
