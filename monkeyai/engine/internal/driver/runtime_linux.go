package driver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"sync"
	"syscall"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
	containerd "github.com/containerd/containerd/v2/client"
	"github.com/containerd/containerd/v2/pkg/cio"
	"github.com/containerd/errdefs"
	specs "github.com/opencontainers/runtime-spec/specs-go"
)

type runtimeEvent struct {
	Event    string `json:"event"`
	Reason   string `json:"reason"`
	UserCode string `json:"userCode"`
	standalone.Status
}
type runtimeOutput struct {
	mu      sync.Mutex
	partial []byte
	total   int
	events  chan runtimeEvent
	err     error
}

func (o *runtimeOutput) Write(p []byte) (int, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.err != nil {
		return 0, o.err
	}
	o.total += len(p)
	if o.total > 64<<10 {
		o.err = errors.New("运行时输出超过上限")
		return 0, o.err
	}
	o.partial = append(o.partial, p...)
	for {
		end := bytes.IndexByte(o.partial, '\n')
		if end < 0 {
			break
		}
		line := o.partial[:end]
		o.partial = o.partial[end+1:]
		var event runtimeEvent
		if json.Unmarshal(line, &event) != nil {
			o.err = errors.New("运行时输出协议无效")
			return 0, o.err
		}
		select {
		case o.events <- event:
		default:
			o.err = errors.New("运行时事件超过上限")
			return 0, o.err
		}
	}
	return len(p), nil
}
func (d *Driver) runtimeTask(ctx context.Context, s lifecycle.Spec) (containerd.Task, *specs.Process, error) {
	if s.Runtime == nil {
		return nil, nil, errors.New("环境未启用 standalone")
	}
	actual, err := d.Inspect(ctx, s, "")
	if err != nil {
		return nil, nil, err
	}
	if actual.Phase != lifecycle.InstanceRunning {
		return nil, nil, errors.New("环境主进程未运行")
	}
	c, err := d.load(ctx, s, "")
	if err != nil {
		return nil, nil, err
	}
	oci, err := c.Spec(ctx)
	if err != nil {
		return nil, nil, err
	}
	if err = taskLimit(oci); err != nil {
		return nil, nil, err
	}
	task, err := c.Task(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	process := *oci.Process
	process.Terminal = false
	return task, &process, nil
}
func cleanupRuntime(ctx context.Context, p containerd.Process) error {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	status, err := p.Status(ctx)
	if errdefs.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if status.Status != containerd.Stopped && status.Status != containerd.Created {
		wait, err := p.Wait(ctx)
		if err != nil {
			return err
		}
		if err = p.Kill(ctx, syscall.SIGKILL); err != nil && !errdefs.IsNotFound(err) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case exit := <-wait:
			if exit.Error() != nil {
				return exit.Error()
			}
		}
	}
	_, err = p.Delete(ctx)
	if errdefs.IsNotFound(err) {
		return nil
	}
	return err
}
func (d *Driver) runRuntime(ctx context.Context, s lifecycle.Spec, id string, args []string, handle func(runtimeEvent) error) (code uint32, resultErr error) {
	ctx = d.context(ctx)
	task, process, err := d.runtimeTask(ctx, s)
	if err != nil {
		return 0, err
	}
	old, err := task.LoadProcess(ctx, id, nil)
	if err == nil {
		if err = cleanupRuntime(ctx, old); err != nil {
			return 0, err
		}
	} else if !errdefs.IsNotFound(err) {
		return 0, err
	}
	process.Args = append([]string{standalone.Binary}, args...)
	output := &runtimeOutput{events: make(chan runtimeEvent, 16)}
	p, err := task.Exec(ctx, id, process, cio.NewCreator(cio.WithStreams(nil, output, io.Discard)))
	if err != nil {
		return 0, err
	}
	defer func() { resultErr = errors.Join(resultErr, cleanupRuntime(ctx, p)) }()
	wait, err := p.Wait(ctx)
	if err != nil {
		return 0, err
	}
	if err = p.Start(ctx); err != nil {
		return 0, err
	}
	for {
		select {
		case <-ctx.Done():
			return 0, ctx.Err()
		case event := <-output.events:
			if err := handle(event); err != nil {
				return 0, err
			}
		case exit := <-wait:
			if exit.Error() != nil {
				return 0, exit.Error()
			}
			done := make(chan struct{})
			go func() { p.IO().Wait(); close(done) }()
			select {
			case <-ctx.Done():
				p.IO().Cancel()
				return 0, ctx.Err()
			case <-done:
			}
			for {
				select {
				case event := <-output.events:
					if err := handle(event); err != nil {
						return 0, err
					}
				default:
					output.mu.Lock()
					err := output.err
					partial := len(output.partial)
					output.mu.Unlock()
					if partial != 0 && err == nil {
						err = errors.New("运行时输出不完整")
					}
					return exit.ExitCode(), err
				}
			}
		}
	}
}
func (d *Driver) Status(ctx context.Context, s lifecycle.Spec) (standalone.Status, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	var status standalone.Status
	found, missing := false, false
	code, err := d.runRuntime(ctx, s, "monkeyai-status", []string{"status", "--state-dir", standalone.StateDir}, func(event runtimeEvent) error {
		switch event.Event {
		case "status":
			if found {
				return errors.New("重复的运行时状态")
			}
			status = event.Status
			found = true
		case "error":
			missing = event.Reason == "installation_not_initialized"
		}
		return nil
	})
	if err != nil {
		return status, err
	}
	if code != 0 {
		if missing {
			return standalone.Status{}, nil
		}
		return status, errors.New("运行时状态读取失败")
	}
	if !found || !status.Valid() {
		return status, errors.New("运行时没有返回有效公开状态")
	}
	return status, nil
}
func (d *Driver) Login(ctx context.Context, s lifecycle.Spec, authorize func(string) error) error {
	ctx, cancel := context.WithTimeout(ctx, 11*time.Minute)
	defer cancel()
	authorized := false
	code, err := d.runRuntime(ctx, s, "monkeyai-login", []string{"login", "--device-code", "--state-dir", standalone.StateDir, "--server", s.Runtime.Server, "--server-id", s.Runtime.ServerID, "--user", s.Runtime.UserID, "--name", "MonkeyAI Cloud"}, func(event runtimeEvent) error {
		if event.Event == "authorize" {
			if authorized || event.UserCode == "" || len(event.UserCode) > 16 {
				return errors.New("运行时设备申请无效")
			}
			authorized = true
			return authorize(event.UserCode)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if code != 0 || !authorized {
		return errors.New("运行时登录失败")
	}
	return nil
}
func (d *Driver) Serve(ctx context.Context, s lifecycle.Spec, observe bool) error {
	ctx = d.context(ctx)
	task, process, err := d.runtimeTask(ctx, s)
	if err != nil {
		return err
	}
	p, err := task.LoadProcess(ctx, "monkeyai-serve", nil)
	if err == nil {
		status, err := p.Status(ctx)
		if err != nil {
			return err
		}
		if status.Status == containerd.Running {
			return nil
		}
		if status.Status == containerd.Created && !observe {
			return p.Start(ctx)
		}
		return errors.New("运行时已退出，不自动重新执行")
	}
	if !errdefs.IsNotFound(err) {
		return err
	}
	if observe {
		return errors.New("运行时进程消失，不自动重新执行")
	}
	process.Args = []string{standalone.Binary, "serve", "--state-dir", standalone.StateDir, "--engine-bin", standalone.Engine}
	p, err = task.Exec(ctx, "monkeyai-serve", process, cio.NullIO)
	if err != nil {
		return err
	}
	// NullIO 不依赖 engine 进程，服务重启后仍由 containerd 管理同一执行进程。
	return p.Start(ctx)
}
