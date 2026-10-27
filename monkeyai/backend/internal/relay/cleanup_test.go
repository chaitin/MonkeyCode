package relay

import (
	"bytes"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

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
	r := &route{target: target{"user", "machine"}, ready: true, ws: <-accepted}
	s := &Service{logger: logger, routes: map[target]*route{r.target: r}}
	var workers sync.WaitGroup
	for range 10 {
		workers.Go(func() { s.closeRoute(r) })
	}
	workers.Wait()
	if r.ready || !r.closed || len(s.routes) != 0 {
		t.Fatal("关闭后仍可使用路由")
	}
	if strings.Contains(logs.String(), "关闭资源失败") {
		t.Fatal(logs.String())
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
