package steps

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/deploy"
)

var packageDir = func() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.Dir(exe), nil
}

func locateBundleFile(name string) (string, error) {
	dir, err := packageDir()
	if err != nil {
		return "", err
	}
	bundle := filepath.Join(dir, name)
	if _, err := os.Stat(bundle); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("找不到离线包: %s", bundle)
		}
		return "", err
	}
	return bundle, nil
}

func wrapRunner(r deploy.Runner, rep Reporter, prefix string) deploy.Runner {
	log := func(line string) { rep.Log("%s%s", prefix, line) }
	return loggingRunnerAdapter{inner: r, log: log}
}

type loggingRunnerAdapter struct {
	inner deploy.Runner
	log   deploy.LogFunc
}

func (a loggingRunnerAdapter) Run(ctx context.Context, name string, args ...string) deploy.RunResult {
	if a.log != nil {
		a.log("$ " + name + " " + strings.Join(args, " "))
	}
	res := a.inner.Run(ctx, name, args...)
	emitMultiline(a.log, res.Stdout)
	emitMultiline(a.log, res.Stderr)
	return res
}

func (a loggingRunnerAdapter) RunShell(ctx context.Context, script string) deploy.RunResult {
	if a.log != nil {
		a.log("$ sh -c " + script)
	}
	res := a.inner.RunShell(ctx, script)
	emitMultiline(a.log, res.Stdout)
	emitMultiline(a.log, res.Stderr)
	return res
}

func emitMultiline(log deploy.LogFunc, s string) {
	if log == nil || s == "" {
		return
	}
	for _, line := range strings.Split(strings.TrimRight(s, "\n"), "\n") {
		log(line)
	}
}
