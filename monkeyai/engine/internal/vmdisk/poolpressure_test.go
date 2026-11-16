package vmdisk

import "testing"

func TestPoolInodeReservationsSurviveRestart(t *testing.T) {
	p := testPool(t)
	if err := p.ReserveFiles(t.Context(), "a", 100, 1, 60); err != nil {
		t.Fatal(err)
	}
	next, err := NewPool(p.root, p.path, p.limit, p.policy)
	if err != nil {
		t.Fatal(err)
	}
	next.capacity = p.capacity
	if err := next.ReserveFiles(t.Context(), "b", 100, 1, 40); err == nil {
		t.Fatal("重启丢失了在途inode预算")
	}
	if err := next.Commit("a"); err != nil {
		t.Fatal(err)
	}
	if err := next.ReserveFiles(t.Context(), "b", 100, 1, 40); err != nil {
		t.Fatal(err)
	}
}
func TestPoolPressureLatchSurvivesRestart(t *testing.T) {
	p := testPool(t)
	free := int64(5)
	p.capacity = func(string) (Capacity, error) {
		return Capacity{TotalBytes: 100, AvailableBytes: free, TotalInodes: 100, FreeInodes: 100}, nil
	}
	pressure, err := p.Refresh(t.Context())
	if err != nil || pressure != PressureCritical {
		t.Fatal(pressure, err)
	}
	next, err := NewPool(p.root, p.path, p.limit, p.policy)
	if err != nil {
		t.Fatal(err)
	}
	next.capacity = p.capacity
	free = 40
	if err := next.Reserve(t.Context(), "a", 100, 1); err == nil {
		t.Fatal("低于恢复水位却清除了危险状态")
	}
	free = 60
	if err := next.Reserve(t.Context(), "a", 100, 1); err != nil {
		t.Fatal(err)
	}
}
