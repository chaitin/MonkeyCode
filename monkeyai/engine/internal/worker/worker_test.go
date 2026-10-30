package worker

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
)

type fakeExecutor struct {
	mu        sync.Mutex
	calls     []lifecycle.Spec
	block     bool
	began     chan struct{}
	cancelled chan struct{}
	phase     lifecycle.InstancePhase
}

func (e *fakeExecutor) Apply(ctx context.Context, s lifecycle.Spec) (lifecycle.State, error) {
	e.mu.Lock()
	e.calls = append(e.calls, s)
	block := e.block && s.DesiredState == lifecycle.DesiredRunning
	e.mu.Unlock()
	if block {
		select {
		case e.began <- struct{}{}:
		default:
		}
		<-ctx.Done()
		select {
		case e.cancelled <- struct{}{}:
		default:
		}
		return lifecycle.State{Spec: s, Phase: lifecycle.PhaseFailed}, ctx.Err()
	}
	return lifecycle.State{Spec: s, Phase: lifecycle.Phase(s.DesiredState)}, nil
}
func (e *fakeExecutor) Inspect(_ context.Context, id string) (lifecycle.State, lifecycle.Instance, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.calls) == 0 {
		return lifecycle.State{}, lifecycle.Instance{}, errors.New("missing")
	}
	s := e.calls[len(e.calls)-1]
	return lifecycle.State{Spec: s, Phase: lifecycle.PhaseRunning}, lifecycle.Instance{Ref: s.InstanceID, Phase: e.phase}, nil
}
func target(t *testing.T) lifecycle.Spec {
	t.Helper()
	raw, err := os.ReadFile("../../examples/environment.json")
	if err != nil {
		t.Fatal(err)
	}
	s, err := lifecycle.Decode(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

type testServer struct {
	mu          sync.Mutex
	target      lifecycle.Spec
	fail        bool
	reports     []Observation
	denyRuntime bool
	requests    []standalone.Request
}

func server(t *testing.T, target lifecycle.Spec) (*testServer, *control.Client) {
	t.Helper()
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	state := &testServer{target: target}
	var srv *httptest.Server
	srv = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		state.mu.Lock()
		defer state.mu.Unlock()
		if state.fail {
			w.WriteHeader(503)
			return
		}
		if r.URL.Path == "/api/host/v1/challenges" {
			json.NewEncoder(w).Encode(map[string]string{"challenge": strings.Repeat("x", 43)})
			return
		}
		if r.URL.Path != "/api/host/v1/exchange" {
			w.WriteHeader(404)
			return
		}
		var in struct {
			HostID    string          `json:"host_id"`
			Challenge string          `json:"challenge"`
			Payload   json.RawMessage `json:"payload"`
			Signature []byte          `json:"signature"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		message := []byte("monkeyai-engine/exchange/v1\n" + srv.URL + "\n" + in.HostID + "\n" + in.Challenge + "\n" + control.Digest(in.Payload))
		if !ed25519.Verify(pub, message, in.Signature) {
			t.Error("同步签名未绑定用途与负载")
			w.WriteHeader(401)
			return
		}
		var payload exchange
		if err := json.Unmarshal(in.Payload, &payload); err != nil {
			t.Error(err)
			return
		}
		state.reports = append(state.reports, payload.Results...)
		raw, _ := json.Marshal(state.target)
		reply := commands{Protocol: 1, Targets: []json.RawMessage{raw}, Acknowledged: payload.Results}
		for _, request := range payload.Runtime {
			state.requests = append(state.requests, request)
			reason := ""
			if state.denyRuntime {
				reason = "runtime_authorization_rejected"
			}
			reply.Runtime = append(reply.Runtime, standalone.Reply{Request: request, Reason: reason})
		}
		json.NewEncoder(w).Encode(reply)
	}))
	t.Cleanup(srv.Close)
	client, err := control.New(srv.URL, key)
	if err != nil {
		t.Fatal(err)
	}
	client.HTTP = srv.Client()
	return state, client
}
func directory(t *testing.T) string {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	return root
}
func wait(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("工作线程未完成")
}
func TestResultsSurviveNetworkFailureAndRestart(t *testing.T) {
	s := target(t)
	remote, client := server(t, s)
	exec := &fakeExecutor{phase: lifecycle.InstanceRunning}
	root := directory(t)
	w, err := New(root, exec)
	if err != nil {
		t.Fatal(err)
	}
	cfg := control.Config{HostID: "host-test"}
	if err := w.Tick(t.Context(), client, cfg); err != nil {
		t.Fatal(err)
	}
	wait(t, func() bool { w.mu.Lock(); defer w.mu.Unlock(); return w.entries[s.EnvironmentID].Result != nil })
	remote.mu.Lock()
	remote.fail = true
	remote.mu.Unlock()
	if err := w.Tick(t.Context(), client, cfg); err == nil {
		t.Fatal("模拟断线未失败")
	}
	w.Close()
	reopened, err := New(root, exec)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	remote.mu.Lock()
	remote.fail = false
	remote.mu.Unlock()
	if err := reopened.Tick(t.Context(), client, cfg); err != nil {
		t.Fatal(err)
	}
	remote.mu.Lock()
	reports := append([]Observation(nil), remote.reports...)
	remote.mu.Unlock()
	if len(reports) != 1 || reports[0].Phase != "running" {
		t.Fatal("重启后没有重传结果")
	}
	wait(t, func() bool { reopened.mu.Lock(); defer reopened.mu.Unlock(); return reopened.active == "" })
	exec.mu.Lock()
	calls := len(exec.calls)
	exec.mu.Unlock()
	if calls != 1 {
		t.Fatal("结果恢复后重复执行创建")
	}
}
func TestNewTargetCancelsOldWorkBeforeCleanup(t *testing.T) {
	s := target(t)
	remote, client := server(t, s)
	exec := &fakeExecutor{block: true, began: make(chan struct{}, 1), cancelled: make(chan struct{}, 1)}
	w, err := New(directory(t), exec)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	cfg := control.Config{HostID: "host-test"}
	if err := w.Tick(t.Context(), client, cfg); err != nil {
		t.Fatal(err)
	}
	select {
	case <-exec.began:
	case <-time.After(5 * time.Second):
		t.Fatal("未启动创建")
	}
	remote.mu.Lock()
	remote.target.Generation = 2
	remote.target.DesiredState = lifecycle.DesiredStopped
	remote.mu.Unlock()
	if err := w.Tick(t.Context(), client, cfg); err != nil {
		t.Fatal(err)
	}
	select {
	case <-exec.cancelled:
	case <-time.After(5 * time.Second):
		t.Fatal("新停止目标未取消创建")
	}
	wait(t, func() bool { w.mu.Lock(); defer w.mu.Unlock(); return w.active == "" })
	if err := w.Tick(t.Context(), client, cfg); err != nil {
		t.Fatal(err)
	}
	wait(t, func() bool {
		w.mu.Lock()
		defer w.mu.Unlock()
		e := w.entries[s.EnvironmentID]
		return e.Result != nil && e.Result.Generation == 2 && e.Result.Phase == "stopped"
	})
	if err := w.Tick(t.Context(), client, cfg); err != nil {
		t.Fatal(err)
	}
	remote.mu.Lock()
	defer remote.mu.Unlock()
	for _, report := range remote.reports {
		if report.Generation == 1 {
			t.Fatal("上报了被新目标取消的旧执行结果")
		}
	}
}
func TestSameGenerationConflictAndCorruptJournalFailClosed(t *testing.T) {
	s := target(t)
	remote, client := server(t, s)
	exec := &fakeExecutor{phase: lifecycle.InstanceRunning}
	root := directory(t)
	w, err := New(root, exec)
	if err != nil {
		t.Fatal(err)
	}
	cfg := control.Config{HostID: "host-test"}
	if err := w.Tick(t.Context(), client, cfg); err != nil {
		t.Fatal(err)
	}
	remote.mu.Lock()
	remote.target.Resource.CPUMillis++
	remote.mu.Unlock()
	if err := w.Tick(t.Context(), client, cfg); err == nil {
		t.Fatal("接受同代次规格变化")
	}
	w.Close()
	if err := os.WriteFile(filepath.Join(root, s.EnvironmentID+".json"), []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	if w, err := New(root, exec); err == nil {
		w.Close()
		t.Fatal("损坏记录被忽略")
	}
}
func TestExitedProcessIsReportedWithoutRestart(t *testing.T) {
	s := target(t)
	_, client := server(t, s)
	exec := &fakeExecutor{phase: lifecycle.InstanceStopped}
	w, err := New(directory(t), exec)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	cfg := control.Config{HostID: "host-test"}
	if err := w.Tick(t.Context(), client, cfg); err != nil {
		t.Fatal(err)
	}
	wait(t, func() bool { w.mu.Lock(); defer w.mu.Unlock(); return w.entries[s.EnvironmentID].Result != nil })
	w.mu.Lock()
	w.checked[s.EnvironmentID] = time.Time{}
	w.mu.Unlock()
	if err := w.Tick(t.Context(), client, cfg); err != nil {
		t.Fatal(err)
	}
	wait(t, func() bool {
		w.mu.Lock()
		defer w.mu.Unlock()
		e := w.entries[s.EnvironmentID]
		return e.Result != nil && e.Result.Reason == "process_exited"
	})
	exec.mu.Lock()
	defer exec.mu.Unlock()
	if len(exec.calls) != 1 {
		t.Fatal("退出后自动重新执行")
	}
}

func TestJournalRejectsInvalidResults(t *testing.T) {
	s := target(t)
	for name, e := range map[string]entry{
		"unknown_phase":      {Target: s, Result: &Observation{EnvironmentID: s.EnvironmentID, InstanceID: s.InstanceID, Generation: s.Generation, Phase: "ready"}},
		"wrong_target":       {Target: s, Result: &Observation{EnvironmentID: s.EnvironmentID, InstanceID: s.InstanceID, Generation: s.Generation, Phase: "deleted"}},
		"unknown_reason":     {Target: s, Result: &Observation{EnvironmentID: s.EnvironmentID, InstanceID: s.InstanceID, Generation: s.Generation, Phase: "failed", Reason: "arbitrary"}},
		"ack_without_result": {Target: s, Acknowledged: true},
	} {
		t.Run(name, func(t *testing.T) {
			root := directory(t)
			raw, err := json.Marshal(e)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, s.EnvironmentID+".json"), raw, 0600); err != nil {
				t.Fatal(err)
			}
			if w, err := New(root, &fakeExecutor{}); err == nil {
				w.Close()
				t.Fatal("接受了无效本地结果")
			}
		})
	}
}

type managedExecutor struct{ fakeExecutor }

func (e *managedExecutor) Runtime(ctx context.Context, s lifecycle.Spec, approve standalone.Approve, _ bool) error {
	return approve(ctx, standalone.Request{EnvironmentID: s.EnvironmentID, InstanceID: s.InstanceID, Generation: s.Generation, MachineID: "machine", PublicKey: "public", UserCode: "ABCD-EFGH"})
}
func TestRuntimeApprovalWaitsForSignedExchange(t *testing.T) {
	for _, denied := range []bool{false, true} {
		t.Run(map[bool]string{true: "拒绝", false: "批准"}[denied], func(t *testing.T) {
			s := target(t)
			s.NetworkPolicy = "public-only"
			s.Runtime = &lifecycle.Runtime{Server: "https://ai.example.com", ServerID: "server", UserID: "user"}
			remote, client := server(t, s)
			remote.denyRuntime = denied
			w, err := New(directory(t), &managedExecutor{fakeExecutor{phase: lifecycle.InstanceRunning}})
			if err != nil {
				t.Fatal(err)
			}
			defer w.Close()
			cfg := control.Config{HostID: "host"}
			if err := w.Tick(t.Context(), client, cfg); err != nil {
				t.Fatal(err)
			}
			wait(t, func() bool { w.mu.Lock(); defer w.mu.Unlock(); return w.approval != nil })
			w.mu.Lock()
			result := w.entries[s.EnvironmentID].Result
			w.mu.Unlock()
			if result != nil {
				t.Fatal("后台批准前就上报运行成功")
			}
			if err := w.Tick(t.Context(), client, cfg); err != nil {
				t.Fatal(err)
			}
			wait(t, func() bool { w.mu.Lock(); defer w.mu.Unlock(); return w.entries[s.EnvironmentID].Result != nil })
			w.mu.Lock()
			result = w.entries[s.EnvironmentID].Result
			w.mu.Unlock()
			if denied && (result.Phase != "failed" || result.Reason != "runtime_failed") {
				t.Fatal("拒绝后未终止启动")
			}
			if !denied && result.Phase != "running" {
				t.Fatal("批准后未完成启动")
			}
			files, err := os.ReadDir(w.root)
			if err != nil {
				t.Fatal(err)
			}
			for _, file := range files {
				raw, err := os.ReadFile(filepath.Join(w.root, file.Name()))
				if err != nil {
					t.Fatal(err)
				}
				if strings.Contains(string(raw), "ABCD-EFGH") {
					t.Fatal("设备码写入了执行日志")
				}
			}
		})
	}
}
