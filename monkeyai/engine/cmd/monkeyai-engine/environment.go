package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/host"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func environment(ctx context.Context, args []string, out, stderr io.Writer) int {
	if len(args) > 0 && (args[0] == "list" || args[0] == "status" || args[0] == "history") {
		return diagnostics(ctx, args, out, stderr)
	}
	if len(args) == 0 {
		fmt.Fprintln(stderr, "用法：environment list [--json] | snapshot | status --id ID | history --id ID [--follow] | logs --id ID [-n 行数] | inspect --id ID | apply --file <规格.json> | retained | destroy-disks")
		return 2
	}
	f := flag.NewFlagSet("environment "+args[0], flag.ContinueOnError)
	f.SetOutput(stderr)
	switch args[0] {
	case "snapshot":
		if f.Parse(args[1:]) != nil || f.NArg() != 0 {
			return 2
		}
		rows, err := host.List()
		if err == nil {
			err = json.NewEncoder(out).Encode(rows)
		}
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	case "logs":
		id := f.String("id", "", "环境 ID")
		n := f.Int("n", 100, "显示最近的日志行数（1 至 10000）")
		if f.Parse(args[1:]) != nil || f.NArg() != 0 || *id == "" || *n < 1 || *n > 10000 {
			f.Usage()
			return 2
		}
		if err := host.Logs(ctx, *id, *n, out, stderr); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	case "apply":
		file := f.String("file", "", "规范化环境规格 JSON")
		if f.Parse(args[1:]) != nil || f.NArg() != 0 || *file == "" {
			return 2
		}
		before, err := os.Lstat(*file)
		if err != nil || !before.Mode().IsRegular() {
			fmt.Fprintln(stderr, "环境规格必须是普通文件")
			return 1
		}
		r, err := os.Open(*file)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		defer r.Close()
		info, err := r.Stat()
		if err != nil || !os.SameFile(before, info) || !info.Mode().IsRegular() {
			fmt.Fprintln(stderr, "环境规格文件发生变化")
			return 1
		}
		s, err := lifecycle.Decode(r)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		state, err := host.Apply(ctx, s)
		if state.Spec.EnvironmentID != "" {
			if e := json.NewEncoder(out).Encode(state); e != nil {
				fmt.Fprintln(stderr, e)
				return 1
			}
		}
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	case "retained":
		if f.Parse(args[1:]) != nil || f.NArg() != 0 {
			return 2
		}
		disks, err := host.Retained(ctx)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if err := json.NewEncoder(out).Encode(disks); err != nil {
			return 1
		}
		return 0
	case "destroy-disks":
		id := f.String("id", "", "已删除的环境ID")
		confirmed := f.String("confirm-environment", "", "再次输入同一环境ID，确认不可恢复地销毁系统盘和数据盘")
		if f.Parse(args[1:]) != nil || f.NArg() != 0 || *id == "" || *confirmed != *id {
			return 2
		}
		if err := host.DestroyDisks(ctx, *id, *confirmed); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		fmt.Fprintln(out, "保留磁盘已永久销毁")
		return 0
	case "inspect":
		id := f.String("id", "", "环境 ID")
		if f.Parse(args[1:]) != nil || f.NArg() != 0 || *id == "" {
			return 2
		}
		status, err := host.Inspect(ctx, *id)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		if err := json.NewEncoder(out).Encode(status); err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		return 0
	default:
		fmt.Fprintln(stderr, "未知环境命令")
		return 2
	}
}
