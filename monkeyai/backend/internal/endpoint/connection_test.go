package endpoint

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"
)

func queueConnection(s *Service, u *userState, machine string) *connection {
	ctx, cancel := context.WithCancel(context.Background())
	return &connection{service: s, user: u, machine: machine, credential: Credential{UserID: "user", ExpiresAt: time.Now().Add(time.Hour)}, ctx: ctx, cancel: cancel, done: make(chan struct{}), wake: make(chan struct{}, 1)}
}
func TestQueueBoundsAndSnapshots(t *testing.T) {
	s := NewService(nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "")
	c := queueConnection(s, nil, machineA)
	defer c.cancel()
	for range 64 {
		if !c.enqueue([]byte("x")) {
			t.Fatal("提前拒绝入队")
		}
	}
	if c.enqueue([]byte("x")) {
		t.Fatal("未限制消息数")
	}
	c.snapshot([]byte("old"))
	c.snapshot([]byte("new"))
	if data, high := c.pop(true); !high || string(data) != "new" {
		t.Fatalf("快照未合并 %s", data)
	}
	for range 64 {
		c.pop(false)
	}
	large := make([]byte, maxMessage)
	for range 8 {
		if !c.enqueue(large) {
			t.Fatal("提前触发字节限制")
		}
	}
	if c.enqueue([]byte("x")) {
		t.Fatal("未限制总字节数")
	}
	for range 17 {
		c.reject("target_busy", messageID)
	}
	if !c.dead.Load() || c.code.Load() != 1013 {
		t.Fatal("错误队列无限增长")
	}
}
func TestConnectionFencingAndRouting(t *testing.T) {
	s := NewService(nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "")
	u := s.acquire("user")
	defer s.release("user", u)
	a := queueConnection(s, u, machineA)
	defer a.cancel()
	b := queueConnection(s, u, machineB)
	defer b.cancel()
	old := queueConnection(s, u, machineA)
	defer old.cancel()
	u.connections[machineA] = a
	u.connections[machineB] = b
	u.endpoints[machineA] = Endpoint{MachineID: machineA}
	u.endpoints[machineB] = Endpoint{MachineID: machineB}
	m := Message{Type: "event", ID: messageID, Target: machineB, Method: "agent.example", Payload: json.RawMessage(`{}`)}
	s.route(old, m, 100)
	if !old.dead.Load() || len(b.business) != 0 {
		t.Fatal("旧来源仍可转发")
	}
	for range 10 {
		s.route(a, m, 100)
	}
	if len(b.business) != 10 {
		t.Fatalf("消息未入队 %d", len(b.business))
	}
	b.stop(4002)
	s.route(a, m, 100)
	if len(b.business) != 10 {
		t.Fatal("向失效目标继续投递")
	}
	a.credential.ExpiresAt = time.Now().Add(-time.Second)
	s.route(a, m, 100)
	if a.code.Load() != 4003 {
		t.Fatalf("到期来源未被隔离: %d", a.code.Load())
	}
}
func TestConcurrentQueue(t *testing.T) {
	s := NewService(nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "")
	c := queueConnection(s, nil, machineA)
	defer c.cancel()
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			for range 100 {
				c.enqueue([]byte("x"))
				c.snapshot([]byte("snapshot"))
				c.pop(true)
			}
		})
	}
	wg.Wait()
	if c.businessBytes > 2<<20 || len(c.business) > 64 {
		t.Fatal("并发突破队列上限")
	}
}
func TestUserStateRelease(t *testing.T) {
	s := NewService(nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "")
	u := s.acquire("user")
	v := s.acquire("user")
	if u != v {
		t.Fatal("同用户状态不唯一")
	}
	s.release("user", u)
	s.release("user", v)
	again := s.acquire("user")
	if again != u {
		t.Fatal("限流冷却期间状态被丢弃")
	}
	s.release("user", again)
}
