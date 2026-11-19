package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

const SocketPath = "/var/lib/monkeyai-engine/control/worker.sock"

type Summary struct {
	EnvironmentID    string     `json:"environment_id"`
	Generation       int64      `json:"generation"`
	Desired          string     `json:"desired"`
	Activity         string     `json:"activity"`
	ActiveGeneration int64      `json:"active_generation,omitempty"`
	Started          *time.Time `json:"started_at,omitempty"`
	Phase            string     `json:"reported_phase,omitempty"`
	Reason           string     `json:"reason,omitempty"`
	Acknowledged     bool       `json:"acknowledged"`
}

func (w *Worker) snapshot(id string) []Summary {
	w.mu.Lock()
	defer w.mu.Unlock()
	rows := []Summary{}
	for _, key := range w.ids() {
		if id != "" && id != key {
			continue
		}
		e := w.entries[key]
		row := Summary{EnvironmentID: key, Generation: e.Target.Generation, Desired: string(e.Target.DesiredState), Activity: "queued", Acknowledged: e.Acknowledged}
		if e.Result != nil {
			row.Phase = e.Result.Phase
			row.Reason = e.Result.Reason
			row.Activity = "idle"
		}
		if j, ok := w.active[key]; ok {
			row.Activity = "applying"
			if j.inspect {
				row.Activity = "inspecting"
			}
			row.ActiveGeneration = j.generation
			row.Started = &j.started
		}
		rows = append(rows, row)
	}
	return rows
}

// 由已持有 service.lock 的进程启动，socket 位于宿主私有控制目录。
func (w *Worker) Diagnostics() (func(), error) {
	path := filepath.Join(filepath.Dir(w.root), "worker.sock")
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return nil, errors.New("诊断 socket 路径已被占用")
		}
		if err = os.Remove(path); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	l, err := net.Listen("unix", path)
	if err != nil {
		return nil, err
	}
	if err = os.Chmod(path, 0600); err != nil {
		l.Close()
		return nil, err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /environments", func(wr http.ResponseWriter, r *http.Request) {
		rows := w.snapshot(r.URL.Query().Get("id"))
		wr.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(wr).Encode(rows); err != nil {
			slog.Warn("输出环境列表失败", "error", err)
		}
	})
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second}
	go func() {
		if err := srv.Serve(l); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("诊断接口异常退出", "error", err)
		}
	}()
	return func() { srv.Close() }, nil
}
func Query(ctx context.Context, path, id string) ([]Summary, error) {
	tr := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", path)
	}}
	defer tr.CloseIdleConnections()
	client := http.Client{Transport: tr, Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "GET", "http://localhost/environments", nil)
	if err != nil {
		return nil, err
	}
	q := req.URL.Query()
	q.Set("id", id)
	req.URL.RawQuery = q.Encode()
	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("无法连接宿主引擎诊断接口: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("查询环境失败: HTTP %d", res.StatusCode)
	}
	var rows []Summary
	err = json.NewDecoder(res.Body).Decode(&rows)
	return rows, err
}
