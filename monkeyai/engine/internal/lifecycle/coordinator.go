package lifecycle

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
)

var (
	ErrStaleGeneration    = errors.New("环境配置代次已过期")
	ErrGenerationConflict = errors.New("同一配置代次的规格不一致")
	ErrDeleted            = errors.New("环境已经删除")
	ErrFailedGeneration   = errors.New("当前启动代次已失败，需要显式启动新实例")
	ErrInstanceConflict   = errors.New("实例尚未清理或实例标识已使用")
)

// Coordinator 同步协调单个环境；host 入口负责跨进程锁，worker 在目标更新时取消旧上下文。
type Coordinator struct {
	store  Store
	driver Driver
	mu     sync.Mutex
	locks  map[string]*environmentLock
}

type environmentLock struct {
	mu   sync.Mutex
	refs int
}

func NewCoordinator(store Store, driver Driver) (*Coordinator, error) {
	if store == nil || driver == nil {
		return nil, errors.New("状态存储和执行驱动不能为空")
	}
	return &Coordinator{store: store, driver: driver, locks: make(map[string]*environmentLock)}, nil
}

func (c *Coordinator) lock(id string) func() {
	c.mu.Lock()
	l := c.locks[id]
	if l == nil {
		l = &environmentLock{}
		c.locks[id] = l
	}
	l.refs++
	c.mu.Unlock()
	l.mu.Lock()
	return func() {
		l.mu.Unlock()
		c.mu.Lock()
		defer c.mu.Unlock()
		l.refs--
		if l.refs == 0 {
			delete(c.locks, id)
		}
	}
}

func (c *Coordinator) Apply(ctx context.Context, spec Spec) (State, error) {
	if err := spec.Validate(); err != nil {
		return State{}, err
	}
	spec.Volumes = slices.Clone(spec.Volumes)
	unlock := c.lock(spec.EnvironmentID)
	defer unlock()
	if err := ctx.Err(); err != nil {
		return State{}, err
	}
	state, err := c.store.Load(spec.EnvironmentID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return State{}, err
	}
	if errors.Is(err, ErrNotFound) {
		state = State{Spec: spec, Phase: PhasePending}
	} else {
		if state.Spec.Generation > spec.Generation {
			return state, ErrStaleGeneration
		}
		if state.Phase == PhaseDeleted {
			if spec.DesiredState != DesiredDeleted {
				return state, ErrDeleted
			}
			return state, nil
		}
		if state.Spec.Generation == spec.Generation {
			if !sameSpec(state.Spec, spec) {
				return state, ErrGenerationConflict
			}
			if state.Phase == PhaseFailed && spec.DesiredState == DesiredRunning {
				return state, ErrFailedGeneration
			}
		} else {
			if spec.DesiredState == DesiredRunning {
				if state.Phase != PhaseStopped || state.ProviderRef != "" || state.Spec.InstanceID == spec.InstanceID {
					return state, ErrInstanceConflict
				}
			} else if !sameInstance(state.Spec, spec) {
				return state, ErrInstanceConflict
			}
			state.Spec = spec
			state.Phase = PhasePending
			state.Reason = ""
		}
	}
	if err := c.store.Save(spec.EnvironmentID, state); err != nil {
		return state, err
	}
	if spec.DesiredState != DesiredRunning {
		return c.stop(ctx, state)
	}
	return c.start(ctx, state)
}

func (c *Coordinator) inspect(ctx context.Context, state State) (Instance, error) {
	instance, err := c.driver.Inspect(ctx, state.Spec, state.ProviderRef)
	if err != nil {
		return Instance{}, err
	}
	switch instance.Phase {
	case InstanceAbsent:
	case InstanceCreated, InstanceRunning, InstanceStopped:
		if instance.Ref == "" || (state.ProviderRef != "" && state.ProviderRef != instance.Ref) {
			return Instance{}, errors.New("驱动返回的实例引用不一致")
		}
	default:
		return Instance{}, errors.New("驱动返回未知实例阶段")
	}
	return instance, nil
}

func (c *Coordinator) start(ctx context.Context, state State) (State, error) {
	instance, err := c.inspect(ctx, state)
	if err != nil {
		return c.fail(state, "inspect", err)
	}
	if instance.Phase == InstanceAbsent {
		if state.ProviderRef != "" || state.Phase == PhaseRunning || state.Phase == PhaseStarting {
			return c.fail(state, "inspect", errors.New("已创建的实例消失，不自动重启"))
		}
		state.Phase = PhasePreparing
		if err := c.store.Save(state.Spec.EnvironmentID, state); err != nil {
			return state, err
		}
		if err := c.driver.Prepare(ctx, state.Spec); err != nil {
			return c.fail(state, "prepare", err)
		}
		if err := ctx.Err(); err != nil {
			return c.fail(state, "create", err)
		}
		ref, err := c.driver.Create(ctx, state.Spec)
		if err != nil {
			return c.fail(state, "create", err)
		}
		if ref == "" {
			return c.fail(state, "create", errors.New("驱动返回空实例引用"))
		}
		state.ProviderRef = ref
		if err := c.store.Save(state.Spec.EnvironmentID, state); err != nil {
			return state, err
		}
		instance, err = c.inspect(ctx, state)
		if err != nil {
			return c.fail(state, "inspect", err)
		}
	} else {
		state.ProviderRef = instance.Ref
	}
	switch instance.Phase {
	case InstanceRunning:
		state.Phase = PhaseRunning
		state.Reason = ""
		return state, c.store.Save(state.Spec.EnvironmentID, state)
	case InstanceCreated:
		if state.Phase == PhaseRunning {
			return c.fail(state, "inspect", errors.New("运行实例状态倒退"))
		}
	default:
		return c.fail(state, "inspect", errors.New("实例已退出或未创建，不自动重新执行"))
	}
	state.Phase = PhaseStarting
	if err := c.store.Save(state.Spec.EnvironmentID, state); err != nil {
		return state, err
	}
	if err := ctx.Err(); err != nil {
		return c.fail(state, "start", err)
	}
	if err := c.driver.Start(ctx, state.Spec, state.ProviderRef); err != nil {
		return c.fail(state, "start", err)
	}
	instance, err = c.inspect(ctx, state)
	if err != nil {
		return c.fail(state, "inspect", err)
	}
	if instance.Phase != InstanceRunning {
		return c.fail(state, "start", errors.New("未观测到实例运行"))
	}
	state.Phase = PhaseRunning
	state.Reason = ""
	return state, c.store.Save(state.Spec.EnvironmentID, state)
}

func (c *Coordinator) stop(ctx context.Context, state State) (State, error) {
	state.Phase = PhaseStopping
	if state.Spec.DesiredState == DesiredDeleted {
		state.Phase = PhaseDeleting
	}
	if err := c.store.Save(state.Spec.EnvironmentID, state); err != nil {
		return state, err
	}
	instance, err := c.inspect(ctx, state)
	if err != nil {
		return c.fail(state, "inspect", err)
	}
	if instance.Phase != InstanceAbsent {
		state.ProviderRef = instance.Ref
		if err := c.store.Save(state.Spec.EnvironmentID, state); err != nil {
			return state, err
		}
		if instance.Phase == InstanceRunning {
			if err := c.driver.Stop(ctx, state.Spec, state.ProviderRef); err != nil {
				return c.fail(state, "stop", err)
			}
			instance, err = c.inspect(ctx, state)
			if err != nil {
				return c.fail(state, "inspect", err)
			}
			if instance.Phase == InstanceRunning {
				return c.fail(state, "stop", errors.New("实例仍在运行"))
			}
		}
		if instance.Phase != InstanceAbsent {
			if err := c.driver.Remove(ctx, state.Spec, state.ProviderRef); err != nil {
				return c.fail(state, "remove", err)
			}
			instance, err = c.inspect(ctx, state)
			if err != nil {
				return c.fail(state, "inspect", err)
			}
			if instance.Phase != InstanceAbsent {
				return c.fail(state, "remove", errors.New("实例资源尚未清理"))
			}
		}
	}
	state.ProviderRef = ""
	state.Reason = ""
	state.Phase = PhaseStopped
	if state.Spec.DesiredState == DesiredDeleted {
		state.Phase = PhaseDeleted
	}
	return state, c.store.Save(state.Spec.EnvironmentID, state)
}

func sameInstance(a, b Spec) bool {
	return a.EnvironmentID == b.EnvironmentID && a.InstanceID == b.InstanceID && a.Driver == b.Driver &&
		sameRuntime(a.Runtime, b.Runtime) && a.Image == b.Image && a.ImageDigest == b.ImageDigest && a.NetworkPolicy == b.NetworkPolicy && a.Resource == b.Resource && slices.Equal(a.Volumes, b.Volumes)
}

func sameSpec(a, b Spec) bool { return a.DesiredState == b.DesiredState && sameInstance(a, b) }

func (c *Coordinator) fail(state State, operation string, err error) (State, error) {
	state.Phase = PhaseFailed
	// 驱动错误可能含敏感信息；检查点只保存错误所属步骤。
	state.Reason = operation + "_failed"
	if saveErr := c.store.Save(state.Spec.EnvironmentID, state); saveErr != nil {
		return state, errors.Join(err, saveErr)
	}
	return state, fmt.Errorf("%s: %w", operation, err)
}

func sameRuntime(a, b *Runtime) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
