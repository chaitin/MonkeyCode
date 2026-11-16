package guest

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
)

type fakeBackend struct {
	mu    sync.Mutex
	calls []string
	fail  bool
}

func (f *fakeBackend) add(s string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, s)
	if f.fail {
		return errors.New("private backend detail")
	}
	return nil
}
func (f *fakeBackend) Status(context.Context) (standalone.Status, error) {
	return standalone.Status{MachineID: "public"}, f.add("status")
}
func (f *fakeBackend) Login(_ context.Context, r lifecycle.Runtime, authorize func(string) error) error {
	if err := f.add("login"); err != nil {
		return err
	}
	return authorize("ABCD1234")
}
func (f *fakeBackend) Serve(_ context.Context, observe bool) error {
	if observe {
		return f.add("observe")
	}
	return f.add("serve")
}
func (f *fakeBackend) Shutdown(context.Context) error { return f.add("shutdown") }
func testBinding() Binding {
	return Binding{EnvironmentID: "env-1", InstanceID: "instance-1", BootID: "boot-1"}
}
func fixture(t *testing.T, handler http.Handler, b Binding) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	client, err := NewClient(b, func(ctx context.Context) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	return client
}
func TestManagementLifecycle(t *testing.T) {
	f := &fakeBackend{}
	s, err := NewService(testBinding(), f)
	if err != nil {
		t.Fatal(err)
	}
	c := fixture(t, s, testBinding())
	ctx := context.Background()
	status, err := c.Status(ctx, lifecycle.Spec{})
	if err != nil || status.MachineID != "public" {
		t.Fatal(status, err)
	}
	spec := lifecycle.Spec{Runtime: &lifecycle.Runtime{Server: "https://center.example", ServerID: "server-1", UserID: "user-1"}}
	authorized := false
	if err := c.Login(ctx, spec, func(code string) error {
		if code != "ABCD1234" {
			t.Fatal(code)
		}
		authorized = true
		// 登录流中的授权回调可并发查询公开身份，不能与登录操作互锁。
		_, err := c.Status(ctx, spec)
		return err
	}); err != nil || !authorized {
		t.Fatal(err, authorized)
	}
	if err := c.Serve(ctx, spec, false); err != nil {
		t.Fatal(err)
	}
	if err := c.Serve(ctx, spec, true); err != nil {
		t.Fatal(err)
	}
	if err := c.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if strings.Join(f.calls, ",") != "status,login,status,serve,observe,shutdown" {
		t.Fatal(f.calls)
	}
}
func TestBindingAndInputRejection(t *testing.T) {
	f := &fakeBackend{}
	s, err := NewService(testBinding(), f)
	if err != nil {
		t.Fatal(err)
	}
	b := testBinding()
	b.BootID = "previous-boot"
	c := fixture(t, s, b)
	if _, err := c.Status(t.Context(), lifecycle.Spec{}); err == nil {
		t.Fatal("接受旧启动身份")
	}
	for _, raw := range []string{`{}`, `{"version":1,"unknown":true}`, strings.Repeat("x", 8193)} {
		request := httptest.NewRequest("POST", "/v1/status", strings.NewReader(raw))
		out := httptest.NewRecorder()
		s.ServeHTTP(out, request)
		if out.Code == 200 {
			t.Fatal("非法请求被接受")
		}
	}
	if len(f.calls) != 0 {
		t.Fatalf("非法请求执行了操作: %v", f.calls)
	}
}
func TestBackendErrorDoesNotLeak(t *testing.T) {
	f := &fakeBackend{fail: true}
	s, _ := NewService(testBinding(), f)
	raw, _ := json.Marshal(Request{Version: 1, Binding: testBinding()})
	out := httptest.NewRecorder()
	s.ServeHTTP(out, httptest.NewRequest("POST", "/v1/status", strings.NewReader(string(raw))))
	if strings.Contains(out.Body.String(), "private") || !strings.Contains(out.Body.String(), "operation_failed") {
		t.Fatal(out.Body.String())
	}
}
func TestClientRejectsInvalidStreams(t *testing.T) {
	for _, body := range []string{
		`{"event":"done"}`,
		"{\"event\":\"status\",\"status\":{}}\n",
		"{\"event\":\"status\",\"status\":{}}\n{\"event\":\"done\"}\n{\"event\":\"done\"}\n",
		`{"event":"unknown"}`,
		strings.Repeat("x", 70<<10),
	} {
		c := fixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, body) }), testBinding())
		if _, err := c.Status(t.Context(), lifecycle.Spec{}); err == nil {
			t.Fatalf("接受无效事件流: %.80s", body)
		}
	}
}
func TestLoginCallbackFailure(t *testing.T) {
	f := &fakeBackend{}
	s, _ := NewService(testBinding(), f)
	c := fixture(t, s, testBinding())
	failure := errors.New("authorization denied")
	err := c.Login(t.Context(), lifecycle.Spec{Runtime: &lifecycle.Runtime{Server: "https://center.example", ServerID: "s", UserID: "u"}}, func(string) error { return failure })
	if !errors.Is(err, failure) {
		t.Fatal(err)
	}
}
