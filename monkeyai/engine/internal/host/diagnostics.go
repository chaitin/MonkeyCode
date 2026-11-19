package host

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/firecracker"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/worker"
)

type Summary struct {
	EnvironmentID string          `json:"environment_id"`
	Driver        string          `json:"driver"`
	Generation    int64           `json:"generation"`
	Phase         lifecycle.Phase `json:"phase"`
	Observation   string          `json:"observation,omitempty"`
	Reason        string          `json:"reason,omitempty"`
	Guest         string          `json:"guest"`
	Runtime       string          `json:"runtime"`
	ObservedAt    *time.Time      `json:"observed_at,omitempty"`
}

func summarize(s lifecycle.State, obs *worker.Observation) Summary {
	row := Summary{EnvironmentID: s.Spec.EnvironmentID, Driver: s.Spec.Driver, Generation: s.Spec.Generation, Phase: s.Phase, Reason: s.Reason, Guest: "unknown", Runtime: "unknown"}
	if row.Driver != "firecracker" {
		row.Guest = "n/a"
	}
	if s.Spec.Runtime == nil {
		row.Runtime = "n/a"
	}
	if obs == nil {
		return row
	}
	row.Observation = obs.Phase
	row.ObservedAt = obs.ObservedAt
	if obs.Reason != "" {
		row.Reason = obs.Reason
	}
	if s.Spec.DesiredState == lifecycle.DesiredRunning && s.Spec.Driver == "firecracker" && obs.RuntimeVersion != "" {
		row.Guest = "responsive"
	}
	if obs.Phase == "running" && s.Phase == lifecycle.PhaseRunning && s.Spec.Runtime != nil {
		row.Runtime = "ready"
		if row.Driver == "firecracker" {
			row.Guest = "responsive"
		}
	}
	if obs.Reason == "runtime_failed" {
		row.Runtime = "failed"
	}
	return row
}
func List() ([]Summary, error) {
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		return nil, errors.New("环境操作需要 Linux root")
	}
	states, err := (lifecycle.FileStore{Root: filepath.Join(root, "states")}).List()
	if err != nil {
		return nil, err
	}
	rows := make([]Summary, 0, len(states))
	for _, s := range states {
		obs, err := worker.LastObservation(filepath.Join(filepath.Dir(root), "commands"), s.Spec)
		if err != nil {
			return nil, fmt.Errorf("环境 %s: %w", s.Spec.EnvironmentID, err)
		}
		rows = append(rows, summarize(s, obs))
	}
	return rows, nil
}
func Logs(ctx context.Context, id string, lines int, out, stderr io.Writer) error {
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		return errors.New("环境操作需要 Linux root")
	}
	s, err := (lifecycle.FileStore{Root: filepath.Join(root, "states")}).Load(id)
	if err != nil {
		return err
	}
	if s.Spec.Driver != "firecracker" {
		return errors.New("仅支持 Firecracker 宿主服务日志")
	}
	unit := firecracker.Unit(storage.Key(id))
	fmt.Fprintln(stderr, "宿主服务日志（不含 guest 业务日志）：", unit)
	cmd := exec.CommandContext(ctx, "journalctl", "--unit="+unit, "--lines="+strconv.Itoa(lines), "--no-pager")
	cmd.Stdout = out
	cmd.Stderr = stderr
	return cmd.Run()
}
