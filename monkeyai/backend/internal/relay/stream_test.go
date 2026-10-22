package relay

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/hashicorp/yamux"
)

func TestCanceledOpenReclaimsLateStreamAndKeepsBudget(t *testing.T) {
	left, right := net.Pipe()
	cfg := muxConfig()
	cfg.AcceptBacklog = 1
	client, err := yamux.Client(left, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	server, err := yamux.Server(right, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	first, err := client.OpenStream()
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	s := &Service{}
	b := newDataBudget(&s.metrics)
	permit := b.reserve(true, false, func() {})
	ctx, cancel := context.WithCancel(t.Context())
	a := &access{expiresAt: time.Now().Add(time.Minute), verifiedAt: time.Now(), cancel: cancel}
	done := make(chan error, 1)
	go func() { _, err := s.openStream(ctx, client, b.opens, a, permit); done <- err }()
	deadline := time.NewTimer(time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for len(b.opens) != 1 {
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatal("开流 worker 未启动")
		}
	}
	// retain 与申请 worker 槽在同一 goroutine 完成，等待锁确认引用已建立。
	for {
		b.mu.Lock()
		ready := permit.refs == 2
		b.mu.Unlock()
		if ready {
			break
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatal("开流引用未建立")
		}
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("取消未生效")
		}
	case <-deadline.C:
		t.Fatal("开流取消阻塞")
	}
	permit.release()
	if regular, terminal, _ := b.counts(); regular != 1 || terminal != 1 {
		t.Fatal("迟到流回收前提前释放预算")
	}
	accepted, err := server.AcceptStream()
	if err != nil {
		t.Fatal(err)
	}
	defer accepted.Close()
	late, err := server.AcceptStream()
	if err != nil {
		t.Fatal(err)
	}
	defer late.Close()
	late.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := late.Read(make([]byte, 1)); err == nil {
		t.Fatal("迟到流未关闭")
	}
	for {
		regular, terminal, _ := b.counts()
		if regular == 0 && terminal == 0 && len(b.opens) == 0 {
			break
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatal("迟到流预算未释放")
		}
	}
}
