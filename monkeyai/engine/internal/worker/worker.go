package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockerapi"
	network "github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockernet"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
)

type Executor interface {
	Apply(context.Context, lifecycle.Spec) (lifecycle.State, error)
	Inspect(context.Context, string) (lifecycle.State, lifecycle.Instance, error)
}
type RuntimeExecutor interface {
	Runtime(context.Context, lifecycle.Spec, standalone.Approve, bool) error
}
type RuntimeUpdater interface {
	UpdateRuntime(context.Context, lifecycle.Spec) error
	RuntimeVersion(context.Context, lifecycle.Spec) (string, error)
}
type UsageExecutor interface {
	Usage(context.Context, lifecycle.Spec) (*lifecycle.Usage, error)
}
type approval struct {
	request standalone.Request
	done    chan error
}
type Observation struct {
	ObservedAt     *time.Time            `json:"observed_at,omitempty"`
	Protection     *lifecycle.Protection `json:"protection,omitempty"`
	RuntimeVersion string                `json:"runtime_version,omitempty"`
	Usage          *lifecycle.Usage      `json:"usage,omitempty"`
	EnvironmentID  string                `json:"environment_id"`
	InstanceID     string                `json:"instance_id"`
	Generation     int64                 `json:"generation"`
	Phase          string                `json:"phase"`
	Reason         string                `json:"reason"`
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
	ProtectionProtocol    int                `json:"protection_protocol"`
	RuntimeUpdateProtocol int                `json:"runtime_update_protocol"`
	UsageProtocol         int                `json:"usage_protocol"`
	Protocol              int                `json:"protocol"`
	Cursor                string             `json:"cursor"`
	Targets               []json.RawMessage  `json:"targets"`
	Acknowledged          []Observation      `json:"acknowledged"`
	Runtime               []standalone.Reply `json:"runtime,omitempty"`
}

const (
	operationSlots    = 10
	inspectionSlots   = 2
	operationTimeout  = 35 * time.Minute
	inspectionTimeout = 2 * time.Minute
)

var errJobTimeout = errors.New("环境任务达到总超时")

type job struct {
	generation int64
	inspect    bool
	started    time.Time
	cancel     context.CancelFunc
}
type Worker struct {
	operations, inspections       int
	root                          string
	executor                      Executor
	mu                            sync.Mutex
	entries                       map[string]entry
	writing                       map[string]chan struct{}
	persist                       func(entry) error
	checked                       map[string]time.Time
	cursor                        string
	active                        map[string]job
	lastOperation, lastInspection string
	wg                            sync.WaitGroup
	closed                        bool
	approvals                     []*approval
	runtimeUpdates                bool
	usage                         bool
	protection                    bool
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
	w := &Worker{operations: operationSlots, inspections: inspectionSlots, root: root, executor: executor, entries: map[string]entry{}, checked: map[string]time.Time{}, active: make(map[string]job)}
	w.writing = make(map[string]chan struct{})
	w.persist = w.writeEntry
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
	if r.RuntimeVersion != "" && !lifecycle.ValidRuntimeVersion(r.RuntimeVersion) {
		return false
	}
	if r.EnvironmentID != e.Target.EnvironmentID || r.InstanceID != e.Target.InstanceID || r.Generation != e.Target.Generation {
		return false
	}
	if r.Protection != nil && (e.Target.Driver != "firecracker" || !r.Protection.Valid(r.Generation)) {
		return false
	}
	if r.Phase == "protected" {
		return r.Protection != nil && r.Reason == "storage_pressure"
	}
	if r.Phase != "failed" {
		return r.Phase == string(e.Target.DesiredState) && r.Reason == ""
	}
	switch r.Reason {
	case "apply_failed", "inspect_failed", "process_exited", "local_state_conflict", "runtime_failed", "runtime_upgrade_failed":
		return true
	}
	return false
}
func (w *Worker) writeEntry(e entry) error {
	raw, err := json.Marshal(e)
	if err != nil {
		return err
	}
	return control.Write(filepath.Join(w.root, e.Target.EnvironmentID+".json"), raw, 0600)
}

// 调用方持有 mu 并已确认该环境没有写入。读者只能看到上一次成功落盘的版本。
func (w *Worker) saveLocked(e entry) error {
	id := e.Target.EnvironmentID
	done := make(chan struct{})
	w.writing[id] = done
	w.mu.Unlock()
	err := w.persist(e)
	w.mu.Lock()
	if err == nil {
		w.entries[id] = e
	}
	delete(w.writing, id)
	close(done)
	return err
}
func (w *Worker) Close() {
	w.mu.Lock()
	w.closed = true
	for _, j := range w.active {
		j.cancel()
	}
	w.mu.Unlock()
	w.wg.Wait()
}
func hostTarget(s lifecycle.Spec, cfg control.Config) (lifecycle.Spec, error) {
	if cfg.ServerURL == "" {
		return s, nil
	}
	if err := control.ValidateServer(cfg.ServerURL); err != nil {
		return s, err
	}
	server, err := url.Parse(cfg.Server)
	if err != nil {
		return s, err
	}
	endpoint, _ := url.Parse(cfg.ServerURL)
	registry, repository, ok := strings.Cut(s.Image, "/")
	if ok && strings.EqualFold(registry, server.Host) && strings.HasPrefix(repository, "environments/") {
		s.Image = endpoint.Host + "/" + repository
	}
	if s.Runtime != nil && strings.TrimRight(s.Runtime.Server, "/") == strings.TrimRight(cfg.Server, "/") {
		runtime := *s.Runtime
		runtime.Server = strings.TrimRight(cfg.ServerURL, "/")
		s.Runtime = &runtime
	}
	return s, s.Validate()
}

func (w *Worker) Tick(ctx context.Context, client *control.Client, cfg control.Config) error {
	w.mu.Lock()
	in := exchange{Protocol: 1, Cursor: w.cursor, Results: []Observation{}}
	ids := w.ids()
	for _, id := range ids {
		e := w.entries[id]
		if e.Result != nil && !e.Acknowledged {
			result := *e.Result
			if !w.usage {
				result.Usage = nil
			}
			if !w.runtimeUpdates {
				result.RuntimeVersion = ""
			}
			in.Results = append(in.Results, w.wireObservation(result))
			if len(in.Results) == 16 {
				break
			}
		}
	}
	// 老后台每次交换只接受一项授权；并发请求在内存中按到达顺序处理。
	var pending *approval
	if len(w.approvals) > 0 {
		pending = w.approvals[0]
		in.Runtime = []standalone.Request{pending.request}
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
		s, err = hostTarget(s, cfg)
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
		if len(w.approvals) > 0 && w.approvals[0] == pending && pending.request == reply.Request {
			var err error
			if reply.Reason != "" {
				err = errors.New("后台拒绝运行时授权")
			}
			select {
			case pending.done <- err:
			default:
			}
		}
	}
	for _, ack := range out.Acknowledged {
		if !slices.ContainsFunc(in.Results, func(result Observation) bool { return sameObservation(result, ack) }) {
			return errors.New("后台确认了未提交的结果")
		}
		e := w.entries[ack.EnvironmentID]
		if e.Result == nil || w.writing[ack.EnvironmentID] != nil {
			continue
		}
		result := *e.Result
		if !w.usage {
			result.Usage = nil
		}
		if !w.runtimeUpdates {
			result.RuntimeVersion = ""
		}
		if sameObservation(w.wireObservation(result), ack) {
			if !e.Acknowledged {
				slog.Info("后台确认环境结果", "environment_id", ack.EnvironmentID, "generation", ack.Generation, "phase", ack.Phase)
			}
			e.Acknowledged = true
			if err := w.saveLocked(e); err != nil {
				return err
			}
		}
	}
	advance := true
	for i, s := range targets {
		old, ok := w.entries[s.EnvironmentID]
		if ok && old.Target.Generation > s.Generation {
			continue
		}
		if err := resolveSandboxRoot(&s, out.Targets[i], old.Target); err != nil {
			return err
		}
		if ok && old.Target.Generation == s.Generation {
			a, _ := json.Marshal(old.Target)
			b, _ := json.Marshal(s)
			if string(a) != string(b) {
				return errors.New("后台修改了同代次规格")
			}
			continue
		}
		// 该环境的旧结果仍在刷盘时，先处理其余目标，下轮用原游标重新获取。
		if w.writing[s.EnvironmentID] != nil {
			advance = false
			continue
		}
		if !ok && len(w.entries) >= 10000 {
			return errors.New("本地环境记录超过限制")
		}
		if err := w.saveLocked(entry{Target: s}); err != nil {
			return err
		}
		slog.Info("已接收环境目标", "environment_id", s.EnvironmentID, "generation", s.Generation, "desired", s.DesiredState)
		delete(w.checked, s.EnvironmentID)
		if j, ok := w.active[s.EnvironmentID]; ok && j.generation < s.Generation {
			j.cancel()
		}
	}
	if advance {
		w.cursor = out.Cursor
	}
	w.usage = out.UsageProtocol == 1
	w.runtimeUpdates = out.RuntimeUpdateProtocol >= 1 && out.RuntimeUpdateProtocol <= 2
	w.protection = out.ProtectionProtocol == 1
	w.start(ctx)
	return nil
}

// 旧后台不发送身份字段；只在首次创建时取默认值，重放和停启沿用已落盘的选择。
func resolveSandboxRoot(s *lifecycle.Spec, raw json.RawMessage, previous lifecycle.Spec) error {
	var identity struct {
		Root json.RawMessage `json:"sandbox_root"`
	}
	if err := json.Unmarshal(raw, &identity); err != nil {
		return err
	}
	switch string(identity.Root) {
	case "":
		if previous.EnvironmentID != "" {
			s.SandboxRoot = previous.SandboxRoot
		} else {
			s.SandboxRoot = s.PersistentContainer && s.Generation == 1 && s.DesiredState == lifecycle.DesiredRunning
		}
	case "true", "false": // 已由规格解码器读取。
	default:
		return errors.New("sandbox_root 必须为布尔值")
	}
	if previous.EnvironmentID != "" && s.SandboxRoot != previous.SandboxRoot {
		return errors.New("不能更改已有环境的沙箱身份")
	}
	return s.Validate()
}

func (w *Worker) ids() []string {
	ids := make([]string, 0, len(w.entries))
	for id := range w.entries {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	return ids
}
func (w *Worker) SetConcurrency(operations, inspections int) error {
	if operations < 0 || operations > 64 {
		return errors.New("operation_workers 必须在 0 到 64 之间")
	}
	if inspections < 0 || inspections > 64 {
		return errors.New("inspection_workers 必须在 0 到 64 之间")
	}
	if operations == 0 {
		operations = operationSlots
	}
	if inspections == 0 {
		inspections = inspectionSlots
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.operations, w.inspections = operations, inspections
	slog.Info("环境并发配置已加载", "operation_workers", operations, "inspection_workers", inspections)
	return nil
}
func (w *Worker) start(ctx context.Context) {
	if w.closed || ctx.Err() != nil {
		return
	}
	ids := w.ids()
	ops, checks := w.operations, w.inspections
	for _, j := range w.active {
		if j.inspect {
			checks--
		} else {
			ops--
		}
	}
	w.dispatch(ctx, ids, false, ops, &w.lastOperation)
	w.dispatch(ctx, ids, true, checks, &w.lastInspection)
}
func (w *Worker) dispatch(ctx context.Context, ids []string, inspect bool, slots int, last *string) {
	start, found := slices.BinarySearch(ids, *last)
	if found {
		start++
	}
	for i := range ids {
		if slots <= 0 {
			break
		}
		id := ids[(start+i)%len(ids)]
		e := w.entries[id]
		if _, busy := w.active[id]; busy || w.writing[id] != nil || (e.Result != nil) != inspect {
			continue
		}
		if inspect && (!(e.Result.Phase == "running" || e.Target.Driver == "firecracker" && e.Result.Phase == "failed" || e.Result.Phase == "protected" && e.Target.DesiredState != lifecycle.DesiredRunning) || time.Since(w.checked[id]) < 30*time.Second) {
			continue
		}
		limit := operationTimeout
		if inspect {
			limit = inspectionTimeout
		}
		run, cancel := context.WithTimeoutCause(ctx, limit, errJobTimeout)
		w.active[id] = job{e.Target.Generation, inspect, time.Now().UTC(), cancel}
		*last = id
		slots--
		w.wg.Add(1)
		usage := w.usage
		go func() { defer w.wg.Done(); defer cancel(); w.execute(run, e, usage) }()
	}
}
func (w *Worker) execute(ctx context.Context, e entry, usage bool) {
	s := e.Target
	started := time.Now()
	operation := "apply"
	if e.Result != nil {
		operation = "inspect"
	}
	log := slog.With("environment_id", s.EnvironmentID, "generation", s.Generation, "operation", operation)
	log.Info("开始处理环境")
	var cause error
	result := Observation{EnvironmentID: s.EnvironmentID, InstanceID: s.InstanceID, Generation: s.Generation}
	if e.Result != nil && (e.Result.Phase == "running" || s.Driver == "firecracker" && e.Result.Phase == "failed") {
		state, instance, err := w.executor.Inspect(ctx, s.EnvironmentID)
		if err != nil {
			result.Phase = "failed"
			result.Reason = "inspect_failed"
			cause = err
		} else if state.Spec.Generation != s.Generation || state.Spec.InstanceID != s.InstanceID {
			result.Phase = "failed"
			result.Reason = "local_state_conflict"
		} else if instance.Protection != nil {
			result.Phase = "protected"
			result.Reason = "storage_pressure"
			result.Protection = instance.Protection
		} else if instance.Phase != lifecycle.InstanceRunning {
			result.Phase = "failed"
			result.Reason = "process_exited"
		} else if e.Result.Phase == "failed" {
			result.Phase = "failed"
			result.Reason = e.Result.Reason
		} else {
			result.Phase = "running"
		}
	} else {
		state, err := w.executor.Apply(ctx, s)
		if err != nil {
			result.Phase = "failed"
			result.Reason = "apply_failed"
			cause = err
		} else if state.Spec.Generation != s.Generation || state.Spec.InstanceID != s.InstanceID || string(state.Phase) != string(s.DesiredState) {
			result.Phase = "failed"
			result.Reason = "local_state_conflict"
		} else {
			result.Phase = string(state.Phase)
		}
	}
	if s.Driver == "firecracker" && result.Protection == nil {
		state, instance, err := w.executor.Inspect(ctx, s.EnvironmentID)
		if err == nil && state.Spec.Generation == s.Generation && state.Spec.InstanceID == s.InstanceID && instance.Protection != nil {
			result.Protection = instance.Protection
			if result.Phase != "stopped" && result.Phase != "deleted" {
				result.Phase = "protected"
				result.Reason = "storage_pressure"
			}
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
			cause = err
		}
	}
	if result.Phase == "stopped" && s.RuntimePackage != nil {
		executor, ok := w.executor.(RuntimeUpdater)
		if ok {
			cause = executor.UpdateRuntime(ctx, s)
		}
		if !ok || cause != nil {
			result.Phase, result.Reason = "failed", "runtime_upgrade_failed"
		}
	}
	if ctx.Err() == nil && s.Runtime != nil && s.DesiredState != lifecycle.DesiredDeleted {
		if executor, ok := w.executor.(RuntimeUpdater); ok {
			version, err := executor.RuntimeVersion(ctx, s)
			result.RuntimeVersion = version
			if err != nil {
				log.Warn("读取 runtime 版本失败", "error", dockerapi.Diagnostic(err))
			}
		}
	}
	if result.Phase == "stopped" && s.RuntimePackage != nil && result.RuntimeVersion != s.RuntimePackage.Version {
		result.Phase, result.Reason = "failed", "runtime_upgrade_failed"
	}
	if ctx.Err() == nil && result.Phase == "running" && usage {
		if executor, ok := w.executor.(UsageExecutor); ok {
			// 监控失败不能改变环境生命周期状态。
			usage, err := executor.Usage(ctx, s)
			result.Usage = usage
			if err != nil {
				log.Warn("采集环境用量失败", "error", dockerapi.Diagnostic(err))
			}
		}
	}
	if s.Driver == "firecracker" {
		at := time.Now().UTC()
		result.ObservedAt = &at
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	defer delete(w.active, s.EnvironmentID)
	// 接单或确认可能正在发布新版本；等待时不阻塞其他环境。
	for w.writing[s.EnvironmentID] != nil {
		done := w.writing[s.EnvironmentID]
		w.mu.Unlock()
		<-done
		w.mu.Lock()
	}
	latest := w.entries[s.EnvironmentID]
	timedOut := errors.Is(context.Cause(ctx), errJobTimeout)
	if w.closed || (ctx.Err() != nil && !timedOut) || latest.Target.Generation != s.Generation {
		log.Info("环境处理已取消", "elapsed", time.Since(started))
		return
	}
	if timedOut {
		cause = errJobTimeout
		if result.Phase != "failed" {
			result.Phase = "failed"
			result.Reason = "apply_failed"
			if e.Result != nil {
				result.Reason = "inspect_failed"
			}
		}
	}
	w.checked[s.EnvironmentID] = time.Now()
	if result.Phase == "failed" {
		log.Error("环境处理失败", "phase", result.Phase, "reason", result.Reason, "error", dockerapi.Diagnostic(cause), "elapsed", time.Since(started))
	} else {
		log.Info("环境处理完成", "phase", result.Phase, "elapsed", time.Since(started))
	}
	latest.Result = &result
	latest.Acknowledged = false
	// 持久化失败时不提交结果，后续按本地生命周期检查点核对。
	if err := w.saveLocked(latest); err != nil {
		log.Error("保存环境执行结果失败", "error", err)
	}
}

func sameObservation(a, b Observation) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return bytes.Equal(x, y)
}

func (*Worker) NetworkPolicies(ctx context.Context) []string { return network.Policies(ctx) }

func (w *Worker) approve(ctx context.Context, request standalone.Request) error {
	p := &approval{request: request, done: make(chan error, 1)}
	w.mu.Lock()
	if w.closed || ctx.Err() != nil {
		w.mu.Unlock()
		return errors.New("运行时授权请求冲突")
	}
	w.approvals = append(w.approvals, p)
	w.mu.Unlock()
	defer func() {
		w.mu.Lock()
		w.approvals = slices.DeleteFunc(w.approvals, func(a *approval) bool { return a == p })
		w.mu.Unlock()
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-p.done:
		return err
	}
}
