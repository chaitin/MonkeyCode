package driver

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
)

type runtimeEvent struct {
	Event, Reason, UserCode string
	standalone.Status
}
type execution struct {
	ID            string
	ContainerID   string
	Running       bool
	ExitCode      int
	ProcessConfig struct {
		Entrypoint string
		Arguments  []string
		User       string
		Privileged bool
	}
}

func (d *Driver) runtimeContainer(ctx context.Context, s lifecycle.Spec) (container, error) {
	if s.Runtime == nil {
		return container{}, errors.New("环境未配置 standalone")
	}
	c, err := d.load(ctx, s, "")
	if err != nil {
		return c, err
	}
	if !c.State.Running {
		return c, errors.New("环境容器未运行")
	}
	return c, d.guard(ctx, s, strings.TrimPrefix(c.Name, "/"))
}
func (d *Driver) execCreate(ctx context.Context, c container, args []string) (string, error) {
	var out struct {
		ID string `json:"Id"`
	}
	err := d.client.Do(ctx, "POST", "/containers/"+c.ID+"/exec", map[string]any{"User": "1000:1000", "Privileged": false, "AttachStdout": true, "AttachStderr": true, "Tty": false, "WorkingDir": "/workspace", "Env": []string{"HOME=/home/monkey", "USER=monkey", "LOGNAME=monkey", "PATH=/usr/local/bin:/usr/bin:/bin"}, "Cmd": append([]string{standalone.Binary}, args...)}, &out)
	return out.ID, err
}
func (d *Driver) execInfo(ctx context.Context, id, containerID string) (execution, error) {
	var e execution
	err := d.client.Do(ctx, "GET", "/exec/"+id+"/json", nil, &e)
	if err != nil {
		return e, err
	}
	if e.ContainerID != containerID || e.ProcessConfig.Entrypoint != standalone.Binary || e.ProcessConfig.Privileged || e.ProcessConfig.User != "1000:1000" {
		return e, errors.New("Docker exec 归属或执行身份不一致")
	}
	return e, nil
}
func demux(r io.Reader, out io.Writer) error {
	var header [8]byte
	var total int64
	for {
		_, err := io.ReadFull(r, header[:])
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		n := int64(binary.BigEndian.Uint32(header[4:]))
		total += n
		if n > 64<<10 || total > 64<<10 || (header[0] != 1 && header[0] != 2) {
			return errors.New("Docker exec 输出超过上限或协议无效")
		}
		target := io.Discard
		if header[0] == 1 {
			target = out
		}
		if _, err = io.CopyN(target, r, n); err != nil {
			return err
		}
	}
}
func (d *Driver) runRuntime(ctx context.Context, s lifecycle.Spec, _ string, args []string, handle func(runtimeEvent) error) (code uint32, resultErr error) {
	c, err := d.runtimeContainer(ctx, s)
	if err != nil {
		return 0, err
	}
	id, err := d.execCreate(ctx, c, args)
	if err != nil {
		return 0, err
	}
	// Docker 无独立 exec kill API；协议、超时或授权失败时停止所属容器，避免遗留登录进程。
	defer func() {
		if resultErr != nil {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
			defer cancel()
			resultErr = errors.Join(resultErr, d.client.Do(cleanup, "POST", "/containers/"+c.ID+"/kill?signal=SIGKILL", nil, nil))
		}
	}()
	stream, err := d.client.Stream(ctx, "POST", "/exec/"+id+"/start", map[string]any{"Detach": false, "Tty": false})
	if err != nil {
		return 0, err
	}
	defer stream.Close()
	reader, writer := io.Pipe()
	defer reader.Close()
	done := make(chan error, 1)
	go func() { e := demux(stream, writer); _ = writer.CloseWithError(e); done <- e }()
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), 64<<10)
	for scanner.Scan() {
		var event runtimeEvent
		if err = json.Unmarshal(scanner.Bytes(), &event); err != nil {
			return 0, errors.New("运行时输出协议无效")
		}
		if err = handle(event); err != nil {
			return 0, err
		}
	}
	if err = scanner.Err(); err != nil {
		return 0, err
	}
	if err = <-done; err != nil {
		return 0, err
	}
	for {
		e, err := d.execInfo(ctx, id, c.ID)
		if err != nil {
			return 0, err
		}
		if !e.Running {
			return uint32(e.ExitCode), nil
		}
		select {
		case <-ctx.Done():
			return 0, ctx.Err()
		case <-time.After(50 * time.Millisecond):
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
	c, err := d.runtimeContainer(ctx, s)
	if err != nil {
		return err
	}
	path := filepath.Join(d.instanceDir(s), "serve.json")
	args := []string{"serve", "--state-dir", standalone.StateDir, "--engine-bin", standalone.Engine}
	raw, err := os.ReadFile(path)
	if err == nil {
		var saved struct{ ID, Fingerprint string }
		if json.Unmarshal(raw, &saved) != nil || saved.Fingerprint != fingerprint(s) {
			return errors.New("运行时进程记录无效")
		}
		e, err := d.execInfo(ctx, saved.ID, c.ID)
		if err != nil {
			return err
		}
		if !e.Running {
			return errors.New("运行时进程已退出或启动结果不确定，不自动重复执行")
		}
		if !equivalent(e.ProcessConfig.Arguments, args) {
			return errors.New("运行时服务参数不一致")
		}
		return nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if observe {
		return errors.New("运行时进程记录消失，不自动重新执行")
	}
	id, err := d.execCreate(ctx, c, args)
	if err != nil {
		return err
	}
	raw, _ = json.Marshal(struct{ ID, Fingerprint string }{id, fingerprint(s)})
	if err = control.Write(path, raw, 0600); err != nil {
		return err
	}
	return d.client.Do(ctx, "POST", "/exec/"+id+"/start", map[string]any{"Detach": true, "Tty": false}, nil)
}
