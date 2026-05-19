package deploy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
)

var ErrCommandNotFound = errors.New("command not found")

type RunResult struct {
	Stdout string
	Stderr string
	Err    error
}

type Runner interface {
	Run(ctx context.Context, name string, args ...string) RunResult
	RunShell(ctx context.Context, script string) RunResult
}

type LogFunc func(line string)

func runError(res RunResult) error {
	if res.Err == nil {
		return nil
	}
	if msg := strings.TrimSpace(res.Stderr); msg != "" {
		return fmt.Errorf("%w: %s", res.Err, msg)
	}
	return res.Err
}

func run(ctx context.Context, r Runner, name string, args ...string) error {
	return runError(r.Run(ctx, name, args...))
}

func runShell(ctx context.Context, r Runner, script string) error {
	return runError(r.RunShell(ctx, script))
}

type CommandRunner struct {
	Log LogFunc
}

func (c CommandRunner) Run(ctx context.Context, name string, args ...string) RunResult {
	cmd := exec.CommandContext(ctx, name, args...)
	return c.exec(cmd, name+" "+strings.Join(args, " "))
}

func (c CommandRunner) RunShell(ctx context.Context, script string) RunResult {
	cmd := exec.CommandContext(ctx, "sh", "-c", script)
	return c.exec(cmd, script)
}

func (c CommandRunner) exec(cmd *exec.Cmd, label string) RunResult {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return RunResult{Err: err}
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return RunResult{Err: err}
	}
	if err := cmd.Start(); err != nil {
		return RunResult{Err: err}
	}
	if c.Log != nil {
		c.Log("$ " + label)
	}
	out := streamPipe(stdout, c.Log)
	errOut := streamPipe(stderr, c.Log)
	runErr := cmd.Wait()
	return RunResult{Stdout: out, Stderr: errOut, Err: runErr}
}

func streamPipe(r io.Reader, log LogFunc) string {
	if r == nil {
		return ""
	}
	buf := make([]byte, 0, 1024)
	tmp := make([]byte, 1024)
	pending := []byte{}
	for {
		n, err := r.Read(tmp)
		if n > 0 {
			pending = append(pending, tmp[:n]...)
			for {
				idx := -1
				for i, b := range pending {
					if b == '\n' {
						idx = i
						break
					}
				}
				if idx < 0 {
					break
				}
				line := string(pending[:idx])
				pending = pending[idx+1:]
				buf = append(buf, []byte(line+"\n")...)
				if log != nil {
					log(line)
				}
			}
		}
		if err != nil {
			break
		}
	}
	if len(pending) > 0 {
		buf = append(buf, pending...)
		if log != nil {
			log(string(pending))
		}
	}
	return string(buf)
}
