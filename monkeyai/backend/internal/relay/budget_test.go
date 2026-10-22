package relay

import (
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

func TestDataBudgetFullReattachAndPromotion(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := newDataBudget(&relayMetrics{})
		terminals := make([]*dataPermit, 8)
		for i := range terminals {
			terminals[i] = b.reserve(true, false, func() {})
			if terminals[i] == nil {
				t.Fatal("终端准入失败")
			}
		}
		files := make([]*dataPermit, 7)
		for i := range files {
			files[i] = b.reserve(false, false, func() {})
			if files[i] == nil {
				t.Fatal("文件准入失败")
			}
		}
		if b.reserve(true, false, func() {}) != nil || b.reserve(false, false, func() {}) != nil {
			t.Fatal("超过常规名额")
		}
		for range 4 {
			closed := false
			next := b.reserve(true, true, func() { closed = true })
			if next == nil || b.reserve(true, true, func() {}) != nil {
				t.Fatal("候选名额错误")
			}
			terminals[0].release()
			terminals[0] = next
			if regular, terminal, candidate := b.counts(); regular != 15 || terminal != 8 || candidate {
				t.Fatalf("未原子转常规: %d %d %v", regular, terminal, candidate)
			}
			time.Sleep(6 * time.Second)
			if closed {
				t.Fatal("转常规后被原候选定时器关闭")
			}
		}
		for _, p := range terminals {
			p.release()
		}
		for _, p := range files {
			p.release()
		}
		if regular, terminal, candidate := b.counts(); regular != 0 || terminal != 0 || candidate {
			t.Fatalf("预算泄漏: %d %d %v", regular, terminal, candidate)
		}
	})
}

func TestCandidateTimeoutAndFailedReplacement(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := newDataBudget(&relayMetrics{})
		old := make([]*dataPermit, 8)
		for i := range old {
			old[i] = b.reserve(true, false, func() {})
		}
		closed := false
		p := b.reserve(true, true, func() { closed = true })
		time.Sleep(candidateTTL)
		synctest.Wait()
		if !closed {
			t.Fatal("未在五秒关闭候选")
		}
		p.release()
		for range 3 {
			p = b.reserve(true, true, func() {})
			if p == nil {
				t.Fatal("未释放候选槽")
			}
			p.release()
		}
		if regular, terminal, candidate := b.counts(); regular != 8 || terminal != 8 || candidate {
			t.Fatal("候选失败改变旧流")
		}
		for _, p := range old {
			p.release()
		}
	})
}

func TestCandidateWaitsForBothQuotasAndLateOpen(t *testing.T) {
	b := newDataBudget(&relayMetrics{})
	var old []*dataPermit
	for range 8 {
		old = append(old, b.reserve(true, false, func() {}))
	}
	for range 7 {
		old = append(old, b.reserve(false, false, func() {}))
	}
	p := b.reserve(true, true, func() {})
	old[8].release()
	if _, _, candidate := b.counts(); !candidate {
		t.Fatal("终端仍满额时不能转常规")
	}
	releaseOpen := old[0].retain()
	old[0].release()
	old[0].release()
	if _, _, candidate := b.counts(); !candidate {
		t.Fatal("尚有迟到开流时过早释放预算")
	}
	releaseOpen()
	releaseOpen()
	if _, _, candidate := b.counts(); candidate {
		t.Fatal("迟到流回收后未提升候选")
	}
	for i, slot := range old {
		if i != 0 && i != 8 {
			slot.release()
		}
	}
	p.release()
}

func TestDataBudgetConcurrentAdmissionAndTunnelIsolation(t *testing.T) {
	m := &relayMetrics{}
	old, next := newDataBudget(m), newDataBudget(m)
	var wg sync.WaitGroup
	var admitted atomic.Int64
	permits := make(chan *dataPermit, 100)
	for range 100 {
		wg.Go(func() {
			if p := old.reserve(true, false, func() {}); p != nil {
				admitted.Add(1)
				permits <- p
			}
		})
	}
	wg.Wait()
	close(permits)
	if admitted.Load() != 8 {
		t.Fatalf("并发超发: %d", admitted.Load())
	}
	newStream := next.reserve(true, false, func() {})
	for p := range permits {
		p.release()
	}
	if regular, terminal, _ := next.counts(); regular != 1 || terminal != 1 {
		t.Fatal("旧回调污染新预算")
	}
	newStream.release()
	newStream.release()
	if newStream.retain() != nil {
		t.Fatal("迟到拨号复活已释放的预算")
	}
	if m.regular.Load() != 0 || m.terminal.Load() != 0 {
		t.Fatal("活跃指标未归零")
	}
}
