// [INPUT]: 双通道测试夹具、真实 yamux 和不回应 Pong 的连接。
// [OUTPUT]: 验证失联期限、反向流预算，以及数据附着在控制就绪、换代和撤销边界的回包与诊断。
// [POS]: 控制事件协议和传输生命周期回归。
// [PROTOCOL]: 变更时更新此头部，然后检查 guidelines.md
package relay

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
)

func TestHTTPDataReattachStatus(t *testing.T) {
	f := newFixture(t)
	r := f.runtime(t)
	r.data.Close()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		f.s.mu.Lock()
		route := f.s.routes[target{f.user, r.hello.MachineID}]
		offline := route != nil && route.data == nil
		f.s.mu.Unlock()
		if offline {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	hello := r.hello
	hello.ChannelKind = "data"
	hello.Intent = "attach"
	hello.LeaseEpoch = r.ready.LeaseEpoch
	ws, ready := f.handshake(t, hello, r.private, "data", f.token)
	data, err := yamux.Client(websocket.NetConn(t.Context(), ws, websocket.MessageBinary), muxConfig("data"))
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	if ready.LeaseEpoch != r.ready.LeaseEpoch {
		t.Fatal("数据重建不能更换控制 epoch")
	}
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		response, err := r.client.Get("http://relay.internal/_control/status")
		if err != nil {
			t.Fatal(err)
		}
		var status struct {
			DataOnline bool `json:"data_online"`
		}
		err = json.NewDecoder(response.Body).Decode(&status)
		response.Body.Close()
		if err == nil && status.DataOnline {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("数据附着完成后 status 未上线")
}

type attachLog struct {
	Event, Reason, Code, Phase string
}

type attachLogs chan attachLog

func (logs attachLogs) Write(data []byte) (int, error) {
	var event attachLog
	if json.Unmarshal(data, &event) == nil {
		switch {
		case event.Event == "relay.bridge.waiting",
			event.Event == "protocol.response.error",
			event.Event == "relay.bridge.rejected" && event.Phase == "ready_ack":
			logs <- event
		}
	}
	return len(data), nil
}

func (logs attachLogs) expect(t *testing.T, event, reason string) {
	t.Helper()
	select {
	case got := <-logs:
		if got.Event != event || got.Reason != reason {
			t.Fatalf("收到 %+v，期望 %s / %s", got, event, reason)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("未收到 %s / %s", event, reason)
	}
}

func TestDataAttachAcrossControlPublish(t *testing.T) {
	for _, tc := range []struct {
		action string
		reason string
	}{
		{"ready", ""},
		{"timeout", "control_not_ready"},
		{"stale", "lease_epoch_mismatch"},
		{"wrong_boot", "boot_id_mismatch"},
		{"closed", "control_missing"},
		{"invalid_ack", "control_missing"},
		{"replaced", "lease_epoch_mismatch"},
		{"revoked", "remote_access_disabled"},
		{"grant_revoked", "grant_invalid"},
		{"replaced_after_ready", "route_replaced"},
	} {
		t.Run(tc.action, func(t *testing.T) {
			f := newFixture(t)
			logs := make(attachLogs, 16)
			f.s.logger = logging.New(logs, slog.LevelDebug)
			server := httptest.NewServer(logging.HTTP(f.s.logger)(f.server.Config.Handler))
			t.Cleanup(server.Close)
			f.server = server
			r := f.runtime(t)
			ctx, cancel := context.WithTimeout(t.Context(), 6*time.Second)
			defer cancel()

			// 已完成证明，暂缓控制 ready_ack，让数据握手在真实发布窗口抵达。
			control := f.prove(t, r.hello, r.private, "control", f.token)
			var published Ready
			if err := readWS(ctx, control, &published); err != nil {
				t.Fatal(err)
			}
			ack := ReadyAck{Type: "ready_ack", RegistrationVersion: published.RegistrationVersion, LeaseEpoch: published.LeaseEpoch}
			h := r.hello
			h.ChannelKind, h.Intent, h.LeaseEpoch = "data", "attach", published.LeaseEpoch
			switch tc.action {
			case "stale":
				h.LeaseEpoch = r.ready.LeaseEpoch
			case "wrong_boot":
				h.BootID = uuid.New().String()
			}
			data := f.prove(t, h, r.private, "data", f.token)
			if tc.action != "stale" && tc.action != "wrong_boot" {
				logs.expect(t, "relay.bridge.waiting", "control_not_ready")
			}
			switch tc.action {
			case "closed":
				control.CloseNow()
			case "invalid_ack":
				ack.LeaseEpoch++
				if err := writeWS(ctx, control, ack); err != nil {
					t.Fatal(err)
				}
				var reply map[string]string
				if err := readWS(ctx, control, &reply); err != nil || reply["code"] != "invalid_tunnel_message" {
					t.Fatalf("错误确认未收到协议拒绝: %v %v", reply, err)
				}
				logs.expect(t, "protocol.response.error", "")
			case "replaced":
				f.handshake(t, r.hello, r.private, "control", f.token)
			case "ready", "revoked", "grant_revoked", "replaced_after_ready":
				if tc.action == "revoked" {
					// 只更新持久状态，验证就绪通知后确实重读了授权。
					if _, err := f.pool.Exec(ctx, "UPDATE endpoints SET remote_access_state='revoked' WHERE user_id=$1 AND machine_id=$2", f.user, h.MachineID); err != nil {
						t.Fatal(err)
					}
				}
				if tc.action == "grant_revoked" {
					if _, err := f.pool.Exec(ctx, "UPDATE oauth_grants SET revoked_at=now() WHERE id=$1", f.grant); err != nil {
						t.Fatal(err)
					}
				}
				if err := writeWS(ctx, control, ack); err != nil {
					t.Fatal(err)
				}
			}
			if tc.action == "ready" || tc.action == "replaced_after_ready" {
				var ready Ready
				if err := readWS(ctx, data, &ready); err != nil || ready.LeaseEpoch != published.LeaseEpoch {
					t.Fatalf("数据通道没有附着原代次: %+v %v", ready, err)
				}
				if tc.action == "replaced_after_ready" {
					f.handshake(t, r.hello, r.private, "control", f.token)
				}
				if err := writeWS(ctx, data, ack); err != nil {
					t.Fatal(err)
				}
				if tc.action == "replaced_after_ready" {
					logs.expect(t, "relay.bridge.rejected", tc.reason)
				} else {
					for {
						f.s.mu.Lock()
						active := f.s.routes[target{f.user, h.MachineID}]
						attached := active != nil && active.state.LeaseEpoch == h.LeaseEpoch && active.data != nil && !active.data.IsClosed()
						f.s.mu.Unlock()
						if attached {
							break
						}
						select {
						case <-ctx.Done():
							t.Fatal("已确认的数据通道未上线")
						case <-time.After(5 * time.Millisecond):
						}
					}
				}
				return
			}
			var failure struct {
				Type string `json:"type"`
				Code string `json:"code"`
			}
			code := "device_registration_changed"
			if tc.action == "grant_revoked" {
				code = "permission_denied"
			}
			if err := readWS(ctx, data, &failure); err != nil || failure.Type != "error" || failure.Code != code {
				t.Fatalf("旧客户端收到非预期错误: %+v %v", failure, err)
			}
			logs.expect(t, "protocol.response.error", tc.reason)
		})
	}
}

func TestControlBlackholeClosesRoute(t *testing.T) {
	t.Parallel()
	left, right := net.Pipe()
	cfg := muxConfig("control")
	cfg.ConnectionWriteTimeout = 100 * time.Millisecond
	mux, err := yamux.Server(left, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { mux.Close(); right.Close() })
	// 接收 Ping，但不回应 Pong，模拟中转仍可写入的黑洞。
	go io.Copy(io.Discard, right)
	start := time.Now()
	r := &route{control: mux, ready: true, seen: start, target: target{"owner", "machine"}}
	s := &Service{routes: map[target]*route{r.target: r}, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	stop := make(chan struct{})
	defer close(stop)
	go s.probe(r, stop)
	select {
	case <-time.After(17 * time.Second):
		if s.current(r.target) != r {
			t.Fatal("首个探测超时提前回收了路由")
		}
	case <-mux.CloseChan():
		t.Fatal("首次探测失败不应结束控制通道")
	}
	select {
	case <-mux.CloseChan():
		if time.Since(start) < controlSilenceLimit {
			t.Fatal("未满失联窗口即关闭")
		}
	case <-time.After(time.Until(start.Add(controlSilenceLimit + 5*time.Second))):
		t.Fatal("没有 Pong 的黑洞未按期限回收")
	}
	if s.current(r.target) != nil {
		t.Fatal("黑洞路由仍在线")
	}
}
func TestReverseHTTPBudgetAndReadDeadline(t *testing.T) {
	f := newFixture(t)
	r := f.runtime(t)
	streams := make([]*yamux.Stream, 0, 16)
	for range 15 {
		c, err := r.mux.OpenStream()
		if err != nil {
			t.Fatal(err)
		}
		streams = append(streams, c)
	}
	defer func() {
		for _, c := range streams {
			c.Close()
		}
	}()
	extra, err := r.mux.OpenStream()
	if err == nil {
		defer extra.Close()
		extra.SetDeadline(time.Now().Add(2 * time.Second))
		_, writeErr := io.WriteString(extra, "GET /_control/status HTTP/1.1\r\nHost: relay.internal\r\n\r\n")
		if writeErr == nil {
			var b [1]byte
			_, err = extra.Read(b[:])
			if err == nil {
				t.Fatal("超额控制流应拒绝")
			}
		}
	}
	select {
	case <-time.After(6 * time.Second):
	case <-t.Context().Done():
		t.Fatal("读取期限测试被取消")
	}
	response, err := r.client.Get("http://relay.internal/_control/status")
	if err != nil {
		t.Fatal("慢请求未回收预算", err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("回收预算后其他控制请求应可用")
	}
}
func TestSlowEventConsumerClosesOnlyEpoch(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	runtime.control.Close()
	deadline := time.Now().Add(3 * time.Second)
	for f.s.current(target{f.user, runtime.hello.MachineID}) != nil && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if f.s.current(target{f.user, runtime.hello.MachineID}) != nil {
		t.Fatal("断开事件流未结束 epoch")
	}
	// 新 epoch 用不读取消息体的独立 HTTP stream 消费事件，触发写入期限。
	ws, ready := f.handshake(t, runtime.hello, runtime.private, "control", f.token)
	mux, err := yamux.Client(websocket.NetConn(t.Context(), ws, websocket.MessageBinary), muxConfig("control"))
	if err != nil {
		t.Fatal(err)
	}
	defer mux.Close()
	stream, err := mux.OpenStream()
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	io.WriteString(stream, "GET /_control/events HTTP/1.1\r\nHost: relay.internal\r\n\r\n")
	deadline = time.Now().Add(3 * time.Second)
	var route *route
	for time.Now().Before(deadline) {
		route = f.s.current(target{f.user, runtime.hello.MachineID})
		if route != nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if route == nil || route.state.LeaseEpoch != ready.LeaseEpoch {
		t.Fatal("新 epoch 未上线")
	}
	for range 16 {
		f.s.pushControl(route, map[string]string{"type": "refresh", "connection_id": strings.Repeat("x", 64000)})
	}
	select {
	case <-mux.CloseChan():
	case <-time.After(8 * time.Second):
		t.Fatal("慢事件消费者未在写入期限内回收")
	}
}
