package taskflow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

func TestIsVirtualMachineNotFound(t *testing.T) {
	notFound := errors.New("recv err failed to stop environment: environment not found: env-1")
	if !IsVirtualMachineNotFound(fmt.Errorf("delete vm: %w", notFound)) {
		t.Fatal("wrapped environment-not-found error must be recognized")
	}
	if IsVirtualMachineNotFound(errors.New("failed to stop environment: connection refused")) {
		t.Fatal("unrelated delete error must remain a failure")
	}
	if IsVirtualMachineNotFound(nil) {
		t.Fatal("nil must not be recognized as not found")
	}
}

func TestTerminalReconnectFallsBackOnlyOnOwnerNotFound(t *testing.T) {
	var routes []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		routes = append(routes, r.Header.Get(HeaderRouteCapability)+":"+r.Header.Get(HeaderRouteTargetID))
		if len(routes) == 2 {
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(&TaskflowError{
				Code:           ErrorOwnerNotFound,
				Message:        "terminal owner not found",
				Retryable:      true,
				ExecutionState: ExecutionNotDispatched,
			})
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Errorf("accept websocket: %v", err)
			return
		}
		go func() {
			for {
				if _, _, err := conn.Read(context.Background()); err != nil {
					return
				}
			}
		}()
	}))
	defer server.Close()

	endpoint, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	client := request.NewClient(endpoint.Scheme, endpoint.Host, 3*time.Second)
	vmClient := newVirtualMachineClient(client)
	sheller, err := vmClient.Terminal(context.Background(), &TerminalReq{
		ID:         "vm-1",
		TerminalID: "terminal-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	shell := sheller.(*Shell)
	defer shell.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := shell.reconnect(ctx); err != nil {
		t.Fatal(err)
	}

	want := []string{"agent:vm-1", "terminal:terminal-1", "agent:vm-1"}
	if fmt.Sprint(routes) != fmt.Sprint(want) {
		t.Fatalf("routes = %v, want %v", routes, want)
	}
}
