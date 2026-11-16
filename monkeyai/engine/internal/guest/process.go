package guest

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
)

type Process struct {
	mu       sync.Mutex
	login    chan struct{}
	serve    *exec.Cmd
	exited   bool
	command  func(context.Context, []string) (*exec.Cmd, error)
	shutdown func(context.Context) error
}

func NewProcess() *Process {
	return &Process{login: make(chan struct{}, 1), command: runtimeCommand, shutdown: shutdownVM}
}

type runtimeEvent struct {
	Event  string `json:"event"`
	Reason string `json:"reason"`
	Code   string `json:"userCode"`
	standalone.Status
}

func (p *Process) run(ctx context.Context, args []string, handle func(runtimeEvent) error) (code int, err error) {
	cmd, err := p.command(ctx, args)
	if err != nil {
		return -1, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return -1, err
	}
	if err := cmd.Start(); err != nil {
		return -1, err
	}
	defer func() {
		if err != nil {
			_ = cmd.Process.Kill()
		}
		waitErr := cmd.Wait()
		if err == nil && waitErr != nil {
			var exit *exec.ExitError
			if errors.As(waitErr, &exit) {
				code = exit.ExitCode()
			} else {
				err = waitErr
			}
		}
	}()
	scanner := bufio.NewScanner(io.LimitReader(out, (64<<10)+1))
	scanner.Buffer(make([]byte, 4096), 16<<10)
	total := 0
	for scanner.Scan() {
		total += len(scanner.Bytes()) + 1
		if total > 64<<10 {
			return -1, errors.New("运行时输出超过上限")
		}
		var event runtimeEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			return -1, errors.New("运行时输出无效")
		}
		if err := handle(event); err != nil {
			return -1, err
		}
	}
	return 0, scanner.Err()
}
func (p *Process) Status(ctx context.Context) (standalone.Status, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	var status standalone.Status
	found, missing := false, false
	code, err := p.run(ctx, []string{"status", "--state-dir", standalone.StateDir}, func(event runtimeEvent) error {
		if event.Event == "status" {
			if found {
				return errors.New("重复运行时状态")
			}
			found = true
			status = event.Status
		}
		if event.Event == "error" && event.Reason == "installation_not_initialized" {
			missing = true
		}
		return nil
	})
	if err != nil {
		return status, err
	}
	if missing && !found && code != 0 {
		return standalone.Status{}, nil
	}
	if code != 0 || !found || !status.Valid() {
		return status, errors.New("运行时状态无效")
	}
	return status, nil
}
func (p *Process) Login(ctx context.Context, r lifecycle.Runtime, authorize func(string) error) error {
	if maintenanceMode() {
		return errors.New("维护启动不能登录用户")
	}
	select {
	case p.login <- struct{}{}:
		defer func() { <-p.login }()
	default:
		return errors.New("已有登录操作")
	}
	if !validRuntime(r) || authorize == nil {
		return errors.New("无效登录配置")
	}
	authorized := false
	code, err := p.run(ctx, []string{"login", "--device-code", "--state-dir", standalone.StateDir, "--server", r.Server, "--server-id", r.ServerID, "--user", r.UserID, "--name", "MonkeyAI Cloud"}, func(event runtimeEvent) error {
		if event.Event != "authorize" {
			return nil
		}
		if authorized || len(event.Code) == 0 || len(event.Code) > 16 {
			return errors.New("设备码无效")
		}
		authorized = true
		return authorize(event.Code)
	})
	if err != nil {
		return err
	}
	if code != 0 || !authorized {
		return errors.New("运行时登录未完成")
	}
	return nil
}
func (p *Process) Serve(ctx context.Context, observe bool) error {
	if maintenanceMode() {
		return errors.New("维护启动不能执行用户runtime")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.serve != nil {
		if p.exited {
			return errors.New("运行时已经退出，不自动重启")
		}
		return nil
	}
	if observe {
		return errors.New("没有可认领的运行时进程")
	}
	marker := "/run/monkeyai-runtime-started"
	if err := ctx.Err(); err != nil {
		return err
	}
	// 服务进程自身重启后不重复执行尚无法核对的旧runtime。
	file, err := os.OpenFile(marker, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	cmd, err := p.command(context.Background(), []string{"serve", "--state-dir", standalone.StateDir, "--engine-bin", standalone.Engine})
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	p.serve = cmd
	go func() { _ = cmd.Wait(); p.mu.Lock(); p.exited = true; p.mu.Unlock() }()
	return nil
}
func (p *Process) Shutdown(ctx context.Context) error { return p.shutdown(ctx) }
