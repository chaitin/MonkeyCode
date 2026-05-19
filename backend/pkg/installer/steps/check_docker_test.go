package steps

import (
	"errors"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/deploy"
)

func ctxWithFakeReporter() (*Context, *fakeReporter, *deploy.FakeRunner) {
	r := &fakeReporter{}
	runner := &deploy.FakeRunner{}
	return &Context{Runner: runner, Reporter: r}, r, runner
}

func TestCheckDockerAllPass(t *testing.T) {
	ctx, _, runner := ctxWithFakeReporter()
	runner.OnRun = func(name string, args ...string) deploy.RunResult {
		switch {
		case args[0] == "--version":
			return deploy.RunResult{Stdout: "Docker version 24.0.5, build abc"}
		case args[0] == "compose":
			return deploy.RunResult{Stdout: "Docker Compose version v2.20.0"}
		case args[0] == "info":
			return deploy.RunResult{Stdout: "24.0.5"}
		}
		return deploy.RunResult{}
	}
	if err := (&CheckDocker{}).Run(ctx); err != nil {
		t.Fatalf("expect pass, got %v", err)
	}
	if !ctx.DockerStatus.Ready() {
		t.Fatal("status should be ready")
	}
}

func TestCheckDockerNotInstalled(t *testing.T) {
	ctx, _, runner := ctxWithFakeReporter()
	runner.OnRun = func(name string, args ...string) deploy.RunResult {
		return deploy.RunResult{Err: errors.New("not found")}
	}
	if err := (&CheckDocker{}).Run(ctx); err != nil {
		t.Fatalf("missing docker should not be fatal: %v", err)
	}
	if ctx.DockerStatus.Ready() {
		t.Fatal("should not be ready")
	}
}

func TestCheckDockerComposeMissing(t *testing.T) {
	ctx, _, runner := ctxWithFakeReporter()
	runner.OnRun = func(name string, args ...string) deploy.RunResult {
		if args[0] == "compose" {
			return deploy.RunResult{Err: errors.New("not found")}
		}
		return deploy.RunResult{Stdout: "ok"}
	}
	err := (&CheckDocker{}).Run(ctx)
	if err == nil || !strings.Contains(err.Error(), "compose") {
		t.Fatalf("expect compose missing error, got %v", err)
	}
}
