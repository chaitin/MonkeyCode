package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/coder/websocket"
)

func testEndpointBridge(t *testing.T, handler http.Handler) {
	t.Helper()
	server := httptest.NewServer(handler)
	defer server.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/endpoints/connect", &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": []string{"Bearer a"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	h := endpoint.Hello{Type: "hello", Versions: []int{1}, MachineID: uuid.New().String(), Profile: endpoint.Profile{DeviceName: "集成测试", Platform: "macos", OSVersion: "15", Arch: "arm64", ClientVersion: "1"}}
	data, _ := json.Marshal(h)
	if err = c.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"welcome", "directory.snapshot"} {
		_, data, err = c.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var message struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(data, &message) != nil || message.Type != kind {
			t.Fatalf("握手顺序错误 %s", data)
		}
	}
	req := httptest.NewRequest("GET", "/api/v1/endpoints", nil)
	req.Header.Set("Authorization", "Bearer a")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 || !strings.Contains(w.Body.String(), h.MachineID) {
		t.Fatalf("端点目录集成失败 %d %s", w.Code, w.Body.String())
	}
}
