package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/selftest"
)

func selftestCommand(ctx context.Context, args []string, out, stderr io.Writer) int {
	flags := flag.NewFlagSet("selftest", flag.ContinueOnError)
	flags.SetOutput(stderr)
	driver := flags.String("driver", "", "需要真实执行验证的固定驱动")
	arch := flags.String("architecture", runtime.GOARCH, "目标架构")
	bundle := flags.String("bundle-dir", "", "固定版本Firecracker组件目录")
	data := flags.String("data-dir", "", "自检临时目录的父目录")
	if flags.Parse(args) != nil || flags.NArg() != 0 || (*driver != "firecracker" && *driver != "gvisor") || (*arch != "amd64" && *arch != "arm64") || !filepath.IsAbs(*data) || filepath.Clean(*data) != *data || *data == "/" {
		return 2
	}
	if *driver == "firecracker" && (!filepath.IsAbs(*bundle) || filepath.Clean(*bundle) != *bundle) {
		return 2
	}
	binary, err := os.Executable()
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	binary, err = filepath.EvalSymlinks(binary)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	ctx, cancel := context.WithTimeout(ctx, 80*time.Second)
	defer cancel()
	report, err := selftest.Inspect(ctx, selftest.Config{Driver: *driver, Architecture: *arch, Bundle: *bundle, DataDir: *data, Engine: binary, Version: version})
	if encodeErr := json.NewEncoder(out).Encode(report); encodeErr != nil {
		fmt.Fprintln(stderr, "输出自检结果失败")
		return 1
	}
	if err != nil || !report.Ready {
		return 1
	}
	return 0
}
