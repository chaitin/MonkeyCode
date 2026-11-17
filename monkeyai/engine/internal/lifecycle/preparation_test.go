package lifecycle

import (
	"context"
	"errors"
	"testing"
)

type preparingDriver struct {
	*fakeDriver
	cleaned    bool
	cleanupErr error
}

func (d *preparingDriver) CleanupPreparation(context.Context, Spec) error {
	d.cleaned = true
	return d.cleanupErr
}

func TestDeleteUncreatedEnvironmentFinalizesPreparation(t *testing.T) {
	for _, blocked := range []bool{false, true} {
		t.Run(map[bool]string{false: "clean", true: "unknown-writer"}[blocked], func(t *testing.T) {
			d := &preparingDriver{fakeDriver: newFake()}
			d.fail = "prepare"
			if blocked {
				d.cleanupErr = errors.New("writer not confirmed")
			}
			c, err := NewCoordinator(FileStore{Root: privateDir(t)}, d)
			if err != nil {
				t.Fatal(err)
			}
			spec := testSpec()
			if _, err := c.Apply(t.Context(), spec); err == nil {
				t.Fatal("模拟准备失败未返回错误")
			}
			spec.Generation++
			spec.DesiredState = DesiredDeleted
			state, err := c.Apply(t.Context(), spec)
			if !d.cleaned {
				t.Fatal("未创建实例的删除跳过准备预算清理")
			}
			if blocked {
				if err == nil || state.Phase != PhaseFailed || state.Reason != "prepare_cleanup_failed" {
					t.Fatal("未知写入者仍标记删除完成", state, err)
				}
			} else {
				if err != nil || state.Phase != PhaseDeleted {
					t.Fatal(state, err)
				}
			}
		})
	}
}
