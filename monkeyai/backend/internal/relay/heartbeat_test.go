// [INPUT]: 依赖真实 yamux 会话、内存连接和生产控制通道配置。
// [OUTPUT]: 验证迟到的 Pong 与开流 ACK 可以在同一控制路由恢复。
// [POS]: relay 传输时序回归，与真实 WebSocket 和数据库集成测试互补。
// [PROTOCOL]: 变更时更新此头部，然后检查 guidelines.md
package relay

import (
	"io"
	"log/slog"
	"net"
	"testing"
	"time"

	"github.com/hashicorp/yamux"
)

// 首帧已写出，延迟交给对端 yamux，由它生成真正的 Pong。
type delayedFirstRead struct {
	net.Conn
	delay time.Duration
}

func (c *delayedFirstRead) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	if n > 0 && c.delay > 0 {
		time.Sleep(c.delay)
		c.delay = 0
	}
	return n, err
}

func TestDelayedControlPongKeepsSameRoute(t *testing.T) {
	t.Parallel()
	left, right := net.Pipe()
	server, err := yamux.Server(left, muxConfig("control"))
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	client, err := yamux.Client(&delayedFirstRead{Conn: right, delay: 15 * time.Second}, muxConfig("control"))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	start := time.Now()
	r := &route{control: server, ready: true, seen: start}
	s := &Service{routes: map[target]*route{r.target: r}, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	stop := make(chan struct{})
	defer close(stop)
	go s.probe(r, stop)
	// 原连接须跨过第 25 秒的旧时限，并在第 30 秒左右收到首个 Pong。
	deadline := time.NewTimer(35 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(50 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-server.CloseChan():
			t.Fatal("Pong 返回前 relay 关闭了控制连接")
		case <-deadline.C:
			t.Fatal("原路由未收到迟到的 Pong")
		case <-tick.C:
			s.mu.Lock()
			confirmed := r.seen.After(start)
			s.mu.Unlock()
			if confirmed {
				if s.current(r.target) != r {
					t.Fatal("Pong 未保住原路由")
				}
				return
			}
		}
	}
}

func TestControlStreamSurvivesDelayedOpenACK(t *testing.T) {
	t.Parallel()
	left, right := net.Pipe()
	server, err := yamux.Server(left, muxConfig("control"))
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	client, err := yamux.Client(right, muxConfig("control"))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	stream, err := server.OpenStream()
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	select {
	case <-server.CloseChan():
		t.Fatal("等待新流 ACK 时关闭了控制连接")
	case <-time.After(15 * time.Second):
	}
	peer, err := client.AcceptStream()
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	if _, err := peer.Write([]byte("ok")); err != nil {
		t.Fatal(err)
	}
	if err := stream.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var b [2]byte
	if _, err := io.ReadFull(stream, b[:]); err != nil || string(b[:]) != "ok" {
		t.Fatal("延迟 ACK 后原流不可用", err)
	}
}

func TestLatePongCannotReviveExpiredOrReplacedRoute(t *testing.T) {
	key := target{"owner", "machine"}
	stale := time.Now().Add(-controlSilenceLimit)
	old := &route{target: key, ready: true, seen: stale}
	s := &Service{routes: map[target]*route{key: old}, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if s.checkHeartbeat(old, true) || !old.closed || !old.seen.Equal(stale) || s.routes[key] != nil {
		t.Fatal("过期 Pong 不能续期")
	}
	// 新代次已切换，旧代次的清理和 Pong 仍可能在路上。
	old = &route{target: key, ready: true, seen: time.Now()}
	current := &route{target: key, ready: true, seen: time.Now()}
	s.routes[key] = current
	if s.checkHeartbeat(old, true) || s.routes[key] != current || current.closed {
		t.Fatal("旧路由的 Pong 影响了新代次")
	}
}

func TestMonitorReclaimsExpiredRouteWithoutWaitingForProbe(t *testing.T) {
	t.Parallel()
	left, right := net.Pipe()
	defer right.Close()
	control, err := yamux.Server(left, muxConfig("control"))
	if err != nil {
		t.Fatal(err)
	}
	defer control.Close()
	key := target{"owner", "machine"}
	r := &route{control: control, ready: true, target: key, seen: time.Now().Add(-controlSilenceLimit)}
	s := &Service{routes: map[target]*route{key: r}, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	if s.current(key) != nil || len(s.directoryRoutes(key.user)) != 0 {
		t.Fatal("到期路由仍可通过代理或目录访问")
	}
	stop := make(chan struct{})
	defer close(stop)
	go s.monitor(r, stop)
	select {
	case <-control.CloseChan():
	case <-time.After(8 * time.Second):
		t.Fatal("没有 Pong 时监控循环未独立回收过期路由")
	}
}
