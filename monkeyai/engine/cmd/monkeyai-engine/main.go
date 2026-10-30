package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/host"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/install"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/network"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/preflight"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/preset"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/worker"
)

var version = "dev"

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Args[1:], os.Stdout, os.Stderr))
}

func run(ctx context.Context, args []string, out, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "用法：monkeyai-engine install | serve | environment | cache | doctor | validate-preset | version")
		return 2
	}
	switch args[0] {
	case "cache":
		if len(args) != 2 || (args[1] != "inspect" && args[1] != "gc") {
			fmt.Fprintln(stderr, "用法：monkeyai-engine cache inspect | gc")
			return 2
		}
		report, err := host.Cache(ctx, args[1] == "gc")
		if report.Config.MaxBytes != 0 {
			if e := json.NewEncoder(out).Encode(report); e != nil {
				fmt.Fprintln(stderr, e)
				return 1
			}
		}
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	case "environment":
		return environment(ctx, args[1:], out, stderr)
	case "serve":
		if len(args) != 1 {
			return 2
		}
		commands, err := worker.New("/var/lib/monkeyai-engine/control/commands", host.Executor{})
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if err := control.ServeWithCommands(ctx, stderr, commands); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	case "install":
		var c install.Config
		f := flag.NewFlagSet("install", flag.ContinueOnError)
		f.SetOutput(stderr)
		f.StringVar(&c.Server, "server", "", "后台 HTTPS 地址")
		f.StringVar(&c.Enrollment, "enrollment", "", "一次性接入凭据")
		f.StringVar(&c.Release, "release", "", "固定发行版本")
		f.StringVar(&c.Architecture, "architecture", "", "宿主架构")
		f.StringVar(&c.ManifestSHA, "manifest-sha256", "", "发行清单摘要")
		f.StringVar(&c.DataDir, "data-dir", "/var/lib/monkeyai-engine/data", "专用数据目录")
		if f.Parse(args[1:]) != nil || f.NArg() != 0 {
			return 2
		}
		if err := install.Run(ctx, c, out); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0

	case "version":
		if len(args) != 1 {
			return 2
		}
		fmt.Fprintln(out, version)
		return 0
	case "doctor":
		c := preflight.DefaultConfig()
		f := flag.NewFlagSet("doctor", flag.ContinueOnError)
		f.SetOutput(stderr)
		f.StringVar(&c.Architecture, "architecture", c.Architecture, "目标宿主架构")
		f.StringVar(&c.DataDir, "data-dir", c.DataDir, "预先准备的专用 XFS 数据目录")
		f.StringVar(&c.Socket, "containerd-socket", c.Socket, "专用 containerd Unix socket")
		f.StringVar(&c.CNIDir, "cni-dir", c.CNIDir, "CNI 程序目录")
		if f.Parse(args[1:]) != nil || f.NArg() != 0 {
			return 2
		}
		if err := c.Validate(); err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
		ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
		defer cancel()
		report, err := preflight.Inspect(ctx, c)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		report.NetworkPolicies = network.Policies(ctx)
		if err := json.NewEncoder(out).Encode(report); err != nil {
			fmt.Fprintln(stderr, "无法输出检查报告")
			return 1
		}
		if !report.Prerequisites {
			return 1
		}
		return 0
	case "validate-preset":
		f := flag.NewFlagSet("validate-preset", flag.ContinueOnError)
		f.SetOutput(stderr)
		file := f.String("file", "", "预设 JSON 文件")
		if f.Parse(args[1:]) != nil || f.NArg() != 0 || *file == "" {
			return 2
		}
		before, err := os.Lstat(*file)
		if err != nil || !before.Mode().IsRegular() {
			fmt.Fprintln(stderr, "预设必须是普通文件，不能使用符号链接或管道")
			return 1
		}
		r, err := os.Open(*file)
		if err != nil {
			fmt.Fprintln(stderr, "无法打开预设文件")
			return 1
		}
		defer r.Close()
		info, err := r.Stat()
		if err != nil || !info.Mode().IsRegular() || !os.SameFile(before, info) {
			fmt.Fprintln(stderr, "预设必须是普通文件")
			return 1
		}
		p, err := preset.Decode(r)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if err := json.NewEncoder(out).Encode(map[string]any{"valid": true, "preset_id": p.ID, "revision": p.Revision, "storage_bytes": p.Resources.StorageBytes(), "image_verified": false, "workload_verified": false}); err != nil {
			return 1
		}
		return 0
	default:
		fmt.Fprintln(stderr, "未知命令")
		return 2
	}
}
