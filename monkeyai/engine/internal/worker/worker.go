package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/network"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
)

type Executor interface {
	Apply(context.Context, lifecycle.Spec) (lifecycle.State, error)
	Inspect(context.Context, string) (lifecycle.State, lifecycle.Instance, error)
}
type RuntimeExecutor interface {
	Runtime(context.Context, lifecycle.Spec, standalone.Approve, bool) error
}
type approval struct {
	request standalone.Request
	done    chan error
}
type Observation struct {
	EnvironmentID string `json:"environment_id"`
	InstanceID    string `json:"instance_id"`
	Generation    int64  `json:"generation"`
	Phase         string `json:"phase"`
	Reason        string `json:"reason"`
}
type entry struct {
	Target       lifecycle.Spec `json:"target"`
	Result       *Observation   `json:"result,omitempty"`
	Acknowledged bool           `json:"acknowledged"`
}
type exchange struct {
	Protocol int                  `json:"protocol"`
	Cursor   string               `json:"cursor"`
	Results  []Observation        `json:"results"`
	Runtime  []standalone.Request `json:"runtime,omitempty"`
}
type commands struct {
	Protocol     int                `json:"protocol"`
	Cursor       string             `json:"cursor"`
	Targets      []json.RawMessage  `json:"targets"`
	Acknowledged []Observation      `json:"acknowledged"`
	Runtime      []standalone.Reply `json:"runtime,omitempty"`
}
type Worker struct {
	root       string
	executor   Executor
	mu         sync.Mutex
	entries    map[string]entry
	checked    map[string]time.Time
	cursor     string
	active     string
	generation int64
	cancel     context.CancelFunc
	wg         sync.WaitGroup
	closed     bool
	approval   *approval
}

func New(root string, executor Executor) (*Worker, error) {
	if executor == nil || !filepath.IsAbs(root) || filepath.Clean(root) != root || root == "/" {
		return nil, errors.New("命令工作目录或执行器无效")
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil || resolved != root {
		return nil, errors.New("命令目录不能包含符号链接")
	}
	info, err := os.Stat(root)
	if err != nil || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("命令目录权限无效")
	}
	w := &Worker{root: root, executor: executor, entries: map[string]entry{}, checked: map[string]time.Time{}}
	files, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	if len(files) > 10000 {
		return nil, errors.New("本地环境记录超过限制")
	}
	for _, file := range files {
		if filepath.Ext(file.Name()) != ".json" {
			continue
		}
		path := filepath.Join(root, file.Name())
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || info.Size() > 64<<10 {
			return nil, errors.New("命令记录类型或大小无效")
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var e entry
		if json.Unmarshal(raw, &e) != nil || e.Target.Validate() != nil || file.Name() != e.Target.EnvironmentID+".json" {
			return nil, errors.New("命令记录损坏")
		}
		if e.Result != nil && !validResult(e) {
			return nil, errors.New("本地结果与目标不一致")
		}
		if e.Acknowledged && e.Result == nil {
			return nil, errors.New("本地确认缺少执行结果")
		}
		w.entries[e.Target.EnvironmentID] = e
	}
	return w, nil
}
func validResult(e entry) bool {
	r := e.Result
	if r.EnvironmentID != e.Target.EnvironmentID || r.InstanceID != e.Target.InstanceID || r.Generation != e.Target.Generation {
		return false
	}
	if r.Phase != "failed" {
		return r.Phase == string(e.Target.DesiredState) && r.Reason == ""
	}
	switch r.Reason {
	case "apply_failed", "inspect_failed", "process_exited", "local_state_conflict", "runtime_failed":
		return true
	}
	return false
}
func (w *Worker) save(e entry) error {
	raw, err := json.Marshal(e)
	if err != nil {
		return err
	}
	if err := control.Write(filepath.Join(w.root, e.Target.EnvironmentID+".json"), raw, 0600); err != nil {
		return err
	}
	w.entries[e.Target.EnvironmentID] = e
	return nil
}
func (w *Worker) Close() {
	w.mu.Lock()
	w.closed = true
	if w.cancel != nil {
		w.cancel()
	}
	w.mu.Unlock()
	w.wg.Wait()
}
func (w *Worker) Tick(ctx context.Context, client *control.Client, cfg control.Config) error {
	w.mu.Lock()
	in := exchange{Protocol: 1, Cursor: w.cursor, Results: []Observation{}}
	ids := w.ids()
	for _, id := range ids {
		e := w.entries[id]
		if e.Result != nil && !e.Acknowledged {
			in.Results = append(in.Results, *e.Result)
			if len(in.Results) == 16 {
				break
			}
		}
	}
	if w.approval != nil {
		in.Runtime = []standalone.Request{w.approval.request}
	}
	w.mu.Unlock()
	var out commands
	if err := client.Exchange(ctx, cfg.HostID, in, &out); err != nil {
		return err
	}
	if out.Protocol != 1 || len(out.Targets) > 16 || len(out.Acknowledged) > 16 || len(out.Runtime) > len(in.Runtime) {
		return errors.New("后台命令协议无效")
	}
	targets := make([]lifecycle.Spec, 0, len(out.Targets))
	for _, raw := range out.Targets {
		s, err := lifecycle.Decode(bytes.NewReader(raw))
		if err != nil {
			return err
		}
		targets = append(targets, s)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return context.Canceled
	}
	for _, reply := range out.Runtime {
		if !slices.Contains(in.Runtime, reply.Request) {
			return errors.New("后台返回了未知运行时授权")
		}
		if w.approval != nil && w.approval.request == reply.Request {
			var err error
			if reply.Reason != "" {
				err = errors.New("后台拒绝运行时授权")
			}
			select {
			case w.approval.done <- err:
			default:
			}
		}
	}
	for _, ack := range out.Acknowledged {
		if !slices.Contains(in.Results, ack) {
			return errors.New("后台确认了未提交的结果")
		}
		e := w.entries[ack.EnvironmentID]
		if e.Result != nil && *e.Result == ack {
			e.Acknowledged = true
			if err := w.save(e); err != nil {
				return err
			}
		}
	}
	for _, s := range targets {
		old, ok := w.entries[s.EnvironmentID]
		if ok && old.Target.Generation > s.Generation {
			continue
		}
		if ok && old.Target.Generation == s.Generation {
			a, _ := json.Marshal(old.Target)
			b, _ := json.Marshal(s)
			if string(a) != string(b) {
				return errors.New("后台修改了同代次规格")
			}
			continue
		}
		if !ok && len(w.entries) >= 10000 {
			return errors.New("本地环境记录超过限制")
		}
		if err := w.save(entry{Target: s}); err != nil {
			return err
		}
		delete(w.checked, s.EnvironmentID)
		if w.active == s.EnvironmentID && w.generation < s.Generation && w.cancel != nil {
			w.cancel()
		}
	}
	w.cursor = out.Cursor
	w.start(ctx)
	return nil
}
func (w *Worker) ids() []string {
	ids := make([]string, 0, len(w.entries))
	for id := range w.entries {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	return ids
}
func (w *Worker) start(ctx context.Context) {
	if w.active != "" || w.closed {
		return
	}
	for _, id := range w.ids() {
		e := w.entries[id]
		if e.Result != nil {
			if e.Result.Phase != "running" {
				continue
			}
			if time.Since(w.checked[id]) < 30*time.Second {
				continue
			}
		}
		if time.Since(w.checked[id]) < 3*time.Second {
			continue
		}
		job, cancel := context.WithCancel(ctx)
		w.active = id
		w.generation = e.Target.Generation
		w.cancel = cancel
		w.checked[id] = time.Now()
		w.wg.Add(1)
		go func() { defer w.wg.Done(); defer cancel(); w.execute(job, e) }()
		return
	}
}
func (w *Worker) execute(ctx context.Context, e entry) {
	s := e.Target
	result := Observation{EnvironmentID: s.EnvironmentID, InstanceID: s.InstanceID, Generation: s.Generation}
	if e.Result != nil && e.Result.Phase == "running" {
		state, instance, err := w.executor.Inspect(ctx, s.EnvironmentID)
		if err != nil {
			result.Phase = "failed"
			result.Reason = "inspect_failed"
		} else if state.Spec.Generation != s.Generation || state.Spec.InstanceID != s.InstanceID {
			result.Phase = "failed"
			result.Reason = "local_state_conflict"
		} else if instance.Phase != lifecycle.InstanceRunning {
			result.Phase = "failed"
			result.Reason = "process_exited"
		} else {
			result.Phase = "running"
		}
	} else {
		state, err := w.executor.Apply(ctx, s)
		if err != nil {
			result.Phase = "failed"
			result.Reason = "apply_failed"
		} else if state.Spec.Generation != s.Generation || state.Spec.InstanceID != s.InstanceID || string(state.Phase) != string(s.DesiredState) {
			result.Phase = "failed"
			result.Reason = "local_state_conflict"
		} else {
			result.Phase = string(state.Phase)
		}
	}
	if result.Phase == "running" && s.Runtime != nil {
		executor, ok := w.executor.(RuntimeExecutor)
		if !ok {
			result.Phase = "failed"
			result.Reason = "runtime_failed"
		} else if err := executor.Runtime(ctx, s, w.approve, e.Result != nil); err != nil {
			result.Phase = "failed"
			result.Reason = "runtime_failed"
		}
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.active = ""
	w.cancel = nil
	latest := w.entries[s.EnvironmentID]
	if ctx.Err() != nil || latest.Target.Generation != s.Generation {
		return
	}
	latest.Result = &result
	latest.Acknowledged = false
	// 持久化失败时不提交结果，后续按本地生命周期检查点核对。
	if err := w.save(latest); err != nil {
		w.checked[s.EnvironmentID] = time.Now()
	}
}

func (*Worker) NetworkPolicies(ctx context.Context) []string { return network.Policies(ctx) }

func (w *Worker) approve(ctx context.Context, request standalone.Request) error {
	p := &approval{request: request, done: make(chan error, 1)}
	w.mu.Lock()
	if w.closed || w.approval != nil {
		w.mu.Unlock()
		return errors.New("运行时授权请求冲突")
	}
	w.approval = p
	w.mu.Unlock()
	defer func() {
		w.mu.Lock()
		if w.approval == p {
			w.approval = nil
		}
		w.mu.Unlock()
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-p.done:
		return err
	}
}
