// [INPUT]: 并发关闭请求、WebSocket 与结构化日志。
// [OUTPUT]: 验证路由只清理一次，撤销按流计数，关闭事件保留代次和原因。
// [POS]: 路由释放的并发与诊断回归。
// [PROTOCOL]: 变更时更新此头部，然后检查 guidelines.md
package relay

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
)

func TestRouteCloseIsIdempotent(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	logger := logging.New(&logs, slog.LevelDebug)
	slog.SetDefault(logger)
	defer slog.SetDefault(previous)
	accepted := make(chan *websocket.Conn, 1)
	done := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		accepted <- ws
		<-done
	}))
	defer server.Close()
	defer close(done)
	client, _, err := websocket.Dial(t.Context(), "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseNow()
	r := &route{target: target{"user", "machine"}, ready: true, ws: <-accepted, seen: time.Now()}
	r.hello.BootID = "boot"
	r.state.LeaseEpoch = 3
	s := &Service{logger: logger, routes: map[target]*route{r.target: r}}
	var workers sync.WaitGroup
	for range 10 {
		workers.Go(func() { s.closeRoute(r, "service_shutdown") })
	}
	workers.Wait()
	if r.ready || !r.closed || len(s.routes) != 0 {
		t.Fatal("关闭后仍可使用路由")
	}
	if strings.Contains(logs.String(), "关闭资源失败") {
		t.Fatal(logs.String())
	}
	var event struct {
		Event   string `json:"event"`
		Machine string `json:"machine_id"`
		Boot    string `json:"boot_id"`
		Epoch   int64  `json:"lease_epoch"`
		Channel string `json:"channel_kind"`
		Reason  string `json:"reason"`
		Age     *int64 `json:"last_seen_age_ms"`
	}
	if err := json.Unmarshal(logs.Bytes(), &event); err != nil {
		t.Fatal("同一代次应只有一条关闭记录", err)
	}
	if event.Event != "relay.route.closed" || event.Machine != "machine" || event.Boot != "boot" || event.Epoch != 3 || event.Channel != "control" || event.Reason != "service_shutdown" || event.Age == nil || *event.Age < 0 {
		t.Fatalf("关闭记录缺少归因字段: %+v", event)
	}
}

func TestClosedConnectionDoesNotHideTimeout(t *testing.T) {
	for _, err := range []error{net.ErrClosed, io.EOF, yamux.ErrSessionShutdown} {
		if !closedConnection(fmt.Errorf("关闭: %w", err)) {
			t.Fatal(err)
		}
	}
	if closedConnection(&net.DNSError{IsTimeout: true}) {
		t.Fatal("探测超时不能被忽略")
	}
}

func TestGrantRevocationClosesSharedGrantAccessOnce(t *testing.T) {
	a := &access{id: "desktop", clientGrant: "shared"}
	r := &route{
		target: target{"owner", "machine"}, seen: time.Now(),
		controlQueue: make(chan any, 2), streams: map[*access]struct{}{a: {}},
	}
	r.principal.GrantID = a.clientGrant
	_, key, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	s := &Service{routes: map[target]*route{r.target: r}, key: key, logger: slog.Default()}
	s.InvalidateGrant(a.clientGrant)
	if !r.closed || a.reason != "authorization_revoked" || s.metrics.revoked.Load() != 1 || len(r.controlQueue) != 1 {
		t.Fatalf("路由关闭=%t，流关闭原因=%q，撤销计数=%d，通知数=%d", r.closed, a.reason, s.metrics.revoked.Load(), len(r.controlQueue))
	}
}
