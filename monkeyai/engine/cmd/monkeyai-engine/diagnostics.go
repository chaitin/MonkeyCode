package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os/exec"
	"regexp"
	"text/tabwriter"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/worker"
)

func diagnostics(ctx context.Context, args []string, out, stderr io.Writer) int {
	f := flag.NewFlagSet("environment "+args[0], flag.ContinueOnError)
	f.SetOutput(stderr)
	var id string
	var follow, asJSON bool
	if args[0] != "list" {
		f.StringVar(&id, "id", "", "环境 ID")
	}
	if args[0] == "history" {
		f.BoolVar(&follow, "follow", false, "持续查看新事件")
	} else if args[0] == "list" {
		f.BoolVar(&asJSON, "json", false, "输出 JSON")
	}
	if f.Parse(args[1:]) != nil || f.NArg() != 0 {
		return 2
	}
	if args[0] != "list" && !lifecycle.ValidEnvironmentID(id) {
		fmt.Fprintln(stderr, "需要有效的 --id")
		return 2
	}
	if args[0] == "history" {
		argv := []string{"--no-pager", "-u", "monkeyai-engine.service", "-o", "short-iso-precise", "--grep", "(?:^|[[:space:]])environment_id=" + regexp.QuoteMeta(id) + "(?:[[:space:]]|$)"}
		if follow {
			argv = append(argv, "--follow")
		}
		cmd := exec.CommandContext(ctx, "journalctl", argv...)
		cmd.Stdout = out
		cmd.Stderr = stderr
		if err := cmd.Run(); err != nil {
			fmt.Fprintln(stderr, "读取环境历史失败：", err)
			return 1
		}
		return 0
	}
	rows, err := worker.Query(ctx, worker.SocketPath, id)
	if err == nil && args[0] == "status" {
		if len(rows) != 1 {
			err = errors.New("宿主未接到该环境的目标")
		} else {
			row := rows[0]
			info := struct {
				worker.Summary
				LocalPhase      lifecycle.Phase `json:"local_phase,omitempty"`
				ProviderRef     string          `json:"provider_ref,omitempty"`
				LocalGeneration int64           `json:"local_generation,omitempty"`
			}{Summary: row}
			s, e := (lifecycle.FileStore{Root: "/var/lib/monkeyai-engine/control/environments/states"}).Load(id)
			if e == nil {
				info.LocalPhase = s.Phase
				info.ProviderRef = s.ProviderRef
				info.LocalGeneration = s.Spec.Generation
			} else if !errors.Is(e, lifecycle.ErrNotFound) {
				err = e
			}
			if err == nil {
				err = json.NewEncoder(out).Encode(info)
			}
		}
	} else if err == nil && asJSON {
		err = json.NewEncoder(out).Encode(rows)
	} else if err == nil {
		tw := tabwriter.NewWriter(out, 0, 4, 2, ' ', 0)
		fmt.Fprintln(tw, "环境 ID	代次	目标	调度	执行结果	后台确认")
		for _, r := range rows {
			fmt.Fprintf(tw, "%s	%d	%s	%s	%s	%t\n", r.EnvironmentID, r.Generation, r.Desired, r.Activity, r.Phase, r.Acknowledged)
		}
		err = tw.Flush()
	}
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}
