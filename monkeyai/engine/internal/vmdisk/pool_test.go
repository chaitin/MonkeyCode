package vmdisk

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

func testPool(t *testing.T) *Pool {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	p, err := NewPool(filepath.Join(root, "state"), root, 1000, PressurePolicy{WarningBytes: 30, CriticalBytes: 10, RecoveryBytes: 50, WarningInodes: 30, CriticalInodes: 10, RecoveryInodes: 50})
	if err != nil {
		t.Fatal(err)
	}
	p.capacity = func(string) (Capacity, error) {
		return Capacity{TotalBytes: 100, AvailableBytes: 100, TotalInodes: 100, FreeInodes: 100}, nil
	}
	return p
}
func TestPoolReservesLogicalAndPhysicalSeparately(t *testing.T) {
	p := testPool(t)
	ctx := context.Background()
	// 用户逻辑容量允许超过物理池，而在途准备空间不能超出真实余量。
	if err := p.Reserve(ctx, "env-1", 500, 40); err != nil {
		t.Fatal(err)
	}
	if err := p.Reserve(ctx, "env-2", 500, 40); err == nil {
		t.Fatal("并发准备透支物理预算")
	}
	if err := p.Commit("env-1"); err != nil {
		t.Fatal(err)
	}
	if err := p.Reserve(ctx, "env-2", 500, 40); err != nil {
		t.Fatal(err)
	}
	if err := p.Reserve(ctx, "env-3", 1, 1); err == nil {
		t.Fatal("超过逻辑超卖上限")
	}
	if err := p.Release(ctx, "env-1", func(context.Context) (bool, error) { return false, nil }); err == nil {
		t.Fatal("未确认删除数据就释放逻辑容量")
	}
	if err := p.Release(ctx, "env-1", func(context.Context) (bool, error) { return true, nil }); err != nil {
		t.Fatal(err)
	}
	if err := p.Reserve(ctx, "env-3", 1, 1); err != nil {
		t.Fatal(err)
	}
}
func TestPoolRestartAndReplay(t *testing.T) {
	p := testPool(t)
	ctx := context.Background()
	if err := p.Reserve(ctx, "env-1", 100, 60); err != nil {
		t.Fatal(err)
	}
	if err := p.Reserve(ctx, "env-1", 100, 60); err != nil {
		t.Fatal(err)
	}
	if err := p.Reserve(ctx, "env-1", 200, 60); err == nil {
		t.Fatal("重复环境改变容量")
	}
	next, err := NewPool(p.root, p.path, p.limit, p.policy)
	if err != nil {
		t.Fatal(err)
	}
	next.capacity = p.capacity
	if err := next.Reserve(ctx, "env-2", 100, 20); err == nil {
		t.Fatal("重启丢失未完成预留")
	}
	next.capacity = func(string) (Capacity, error) { return Capacity{}, errors.New("filesystem offline") }
	if err := next.Reserve(ctx, "env-3", 100, 1); err == nil {
		t.Fatal("容量查询失败仍准入")
	}
}
