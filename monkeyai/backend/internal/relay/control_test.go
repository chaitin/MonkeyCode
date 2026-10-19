package relay

import (
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"strings"
	"testing"
	"time"

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
	data, err := yamux.Client(websocket.NetConn(t.Context(), ws, websocket.MessageBinary), muxConfig())
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

func TestControlBlackholeClosesRoute(t *testing.T) {
	left, right := net.Pipe()
	cfg := muxConfig()
	cfg.ConnectionWriteTimeout = 100 * time.Millisecond
	mux, err := yamux.Server(left, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { mux.Close(); right.Close() })
	// 接收 Ping，但不回应 Pong，模拟中转仍可写入的黑洞。
	go io.Copy(io.Discard, right)
	r := &route{control: mux, ready: true, seen: time.Now(), target: target{"owner", "machine"}}
	s := &Service{routes: map[target]*route{r.target: r}, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	stop := make(chan struct{})
	defer close(stop)
	go s.probe(r, stop)
	select {
	case <-mux.CloseChan():
	case <-time.After(20 * time.Second):
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
	mux, err := yamux.Client(websocket.NetConn(t.Context(), ws, websocket.MessageBinary), muxConfig())
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
