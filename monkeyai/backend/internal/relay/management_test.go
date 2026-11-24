package relay

import (
	"encoding/json"
	"github.com/go-chi/chi/v5"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
)

func TestRemoteDeviceManagement(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	machine := runtime.hello.MachineID
	dir, err := os.MkdirTemp("/tmp", "relay-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	listener, err := ListenControl(dir)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: f.s.ControlHandler(f.s.InvalidateGrant)}
	go server.Serve(listener)
	defer server.Close()
	client := NewControl(dir)
	defer client.Close()
	management := chi.NewRouter()
	management.With(f.ids.RequireAgent).Get("/devices", client.Directory().ServeHTTP)
	RegisterRevocation(management, f.ids, f.s.devices, client.InvalidateDevice)
	call := func(method, path, token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("If-Match", strconv.FormatInt(runtime.ready.RegistrationVersion, 10))
		w := httptest.NewRecorder()
		management.ServeHTTP(w, req)
		return w
	}
	readOnly, _ := f.mint(t, f.user, []string{"device:connect"})
	listed := call("GET", "/devices?capability=execute", readOnly)
	var result struct{ Items []map[string]any }
	if listed.Code != 200 || json.Unmarshal(listed.Body.Bytes(), &result) != nil || len(result.Items) != 1 || result.Items[0]["machine_id"] != machine || result.Items[0]["status"] != "online" {
		t.Fatalf("未读到在线设备：%s", listed.Body)
	}
	path := "/api/v1/endpoints/" + machine
	if w := call("DELETE", path, readOnly); w.Code != 403 {
		t.Fatalf("只读凭据撤销返回 %d", w.Code)
	}
	if err := client.InvalidateDevice(t.Context(), f.user, machine, runtime.ready.GrantVersion-1); err != nil {
		t.Fatal(err)
	}
	if f.s.current(target{f.user, machine}) == nil {
		t.Fatal("过期通知断开了新路由")
	}
	if w := call("DELETE", path, f.token); w.Code != 204 {
		t.Fatalf("撤销失败：%d %s", w.Code, w.Body)
	}
	if f.s.current(target{f.user, machine}) != nil {
		t.Fatal("撤销后仍有活动路由")
	}
}
