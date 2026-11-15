package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/hostprobe"
)

func probe(ctx context.Context, args []string, out, stderr io.Writer) int {
	return probeWith(ctx, args, out, stderr, hostprobe.Inspect)
}

func probeWith(ctx context.Context, args []string, out, stderr io.Writer, inspect func(context.Context, hostprobe.Config) (hostprobe.Report, error)) int {
	c := hostprobe.DefaultConfig()
	f := flag.NewFlagSet("probe", flag.ContinueOnError)
	f.SetOutput(stderr)
	f.StringVar(&c.Architecture, "architecture", c.Architecture, "目标宿主架构")
	driver := f.String("driver", string(c.Driver), "平台探测策略：auto、firecracker 或 gvisor")
	current := f.String("current-driver", "", "已保存的执行引擎；修复或升级时保留，不自动切换")
	if f.Parse(args) != nil || f.NArg() != 0 {
		return 2
	}
	c.Driver, c.CurrentDriver = hostprobe.Driver(*driver), hostprobe.Driver(*current)
	if err := c.Validate(); err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	report, err := inspect(ctx, c)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if err := json.NewEncoder(out).Encode(report); err != nil {
		fmt.Fprintln(stderr, "无法输出平台探测报告")
		return 1
	}
	if report.CandidateDriver == "" {
		return 1
	}
	return 0
}
