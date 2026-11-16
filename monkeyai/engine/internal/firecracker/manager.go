package firecracker

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/guest"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmdisk"
)

type Spec struct {
	Fingerprint string      `json:"fingerprint,omitempty"`
	Disks       vmdisk.Spec `json:"disks"`
	VCPUs       int         `json:"vcpus"`
	CPUMillis   int64       `json:"cpu_millis,omitempty"`
	MemoryMiB   int64       `json:"memory_mib"`
	Generation  int64       `json:"generation"`
}
type State struct {
	Protection           *lifecycle.Protection `json:"protection,omitempty"`
	Spec                 Spec                  `json:"spec"`
	ID                   string                `json:"id"`
	BootID               string                `json:"boot_id,omitempty"`
	Lease                string                `json:"lease,omitempty"`
	Phase                string                `json:"phase"`
	Generation           int64                 `json:"generation"`
	ProtectionGeneration int64                 `json:"protection_generation,omitempty"`
}
type Launch struct {
	Maintenance bool
	CPUMillis   int64
	SelfTest    bool
	ID          string
	BootID      string
	Disks       vmdisk.Disks
	VCPUs       int
	MemoryMiB   int64
	Binding     guest.Binding
}

// Host 必须核验进程归属、jailer、cgroup和网络隔离，不能用客体自报确认停止。
type Host interface {
	Start(context.Context, Launch) error
	Running(context.Context, string) (bool, error)
	Stop(context.Context, string) error
	Pause(context.Context, string) error
	Remove(context.Context, string) error
}
type Manager struct {
	root  string
	disks *vmdisk.Manager
	host  Host
}

func NewManager(root string, disks *vmdisk.Manager, host Host) (*Manager, error) {
	if !filepath.IsAbs(root) || filepath.Clean(root) != root || root == "/" || disks == nil || host == nil {
		return nil, errors.New("缺少虚拟机状态目录、存储或隔离执行器")
	}
	if err := storage.PrivateDir(root); err != nil {
		return nil, err
	}
	return &Manager{root, disks, host}, nil
}
func (m *Manager) lock(id string) (func(), error) {
	return control.Lock(filepath.Join(m.root, storage.Key(id)+".lock"))
}
func (m *Manager) path(id string) string { return filepath.Join(m.root, storage.Key(id)+".json") }
func (m *Manager) save(s State) error {
	raw, err := json.Marshal(s)
	if err != nil {
		return err
	}
	return control.Write(m.path(s.Spec.Disks.EnvironmentID), raw, 0600)
}
func (m *Manager) load(id string) (State, error) {
	path := m.path(id)
	info, err := os.Lstat(path)
	if err != nil {
		return State{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > 64<<10 || info.Mode().Perm()&0077 != 0 {
		return State{}, errors.New("虚拟机状态文件不安全")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return State{}, err
	}
	var s State
	if json.Unmarshal(raw, &s) != nil || s.Spec.Disks.EnvironmentID != id || s.ID != storage.Key(id) || s.Generation < 1 || s.Generation < s.ProtectionGeneration {
		return State{}, errors.New("虚拟机状态损坏")
	}
	if s.ProtectionGeneration != 0 && s.Protection == nil || s.Protection != nil && !s.Protection.Valid(s.Generation) {
		return State{}, errors.New("虚拟机保护事件与锁定状态不一致")
	}
	switch s.Phase {
	case "created", "starting", "running", "stopping", "stopped", "paused", "retained", "failed", "maintenance", "destroyed":
	default:
		return State{}, errors.New("未知虚拟机状态")
	}
	return s, nil
}
func (m *Manager) Create(ctx context.Context, spec Spec, template string) (State, error) {
	if spec.Generation < 1 || spec.VCPUs < 1 || spec.VCPUs > 32 || spec.MemoryMiB < 256 || spec.MemoryMiB > 1048576 {
		return State{}, errors.New("虚拟机规格无效")
	}
	unlock, err := m.lock(spec.Disks.EnvironmentID)
	if err != nil {
		return State{}, err
	}
	defer unlock()
	previous, err := m.load(spec.Disks.EnvironmentID)
	if err == nil {
		if previous.Spec != spec {
			return State{}, errors.New("已有环境的规格不能被创建操作覆盖")
		}
		return previous, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return State{}, err
	}
	if _, err := m.disks.Ensure(ctx, spec.Disks, template); err != nil {
		return State{}, err
	}
	s := State{Spec: spec, ID: storage.Key(spec.Disks.EnvironmentID), Phase: "created", Generation: spec.Generation}
	return s, m.save(s)
}
func (m *Manager) Start(ctx context.Context, id string, generation int64) (State, error) {
	return m.start(ctx, id, generation, false)
}
func (m *Manager) Maintain(ctx context.Context, id string, generation int64) (State, error) {
	return m.start(ctx, id, generation, true)
}
func (m *Manager) start(ctx context.Context, id string, generation int64, maintenance bool) (State, error) {
	unlock, err := m.lock(id)
	if err != nil {
		return State{}, err
	}
	defer unlock()
	s, err := m.load(id)
	if err != nil {
		return State{}, err
	}
	if s.ProtectionGeneration != 0 {
		return s, errors.New("环境处于持久保护锁定，需要显式解除")
	}
	if generation < s.Generation {
		return s, errors.New("启动代次已过期")
	}
	if maintenance && (s.Phase != "stopped" || generation != s.Generation) {
		return s, errors.New("维护启动需要已确认停止的同一代次")
	}
	if s.Phase == "running" {
		if generation != s.Generation {
			return s, errors.New("运行环境不能直接接受新启动代次")
		}
		running, err := m.host.Running(ctx, s.ID)
		if err != nil {
			return s, err
		}
		if !running {
			return s, errors.New("虚拟机已退出，不自动再次执行")
		}
		return s, nil
	}
	if s.Phase != "created" && s.Phase != "stopped" {
		return s, errors.New("虚拟机当前状态不允许启动")
	}
	if s.Phase == "stopped" && generation <= s.Generation && !maintenance {
		return s, errors.New("再次启动需要更高代次")
	}
	running, err := m.host.Running(ctx, s.ID)
	if err != nil {
		return s, err
	}
	if running {
		return s, errors.New("已有宿主进程，拒绝创建第二个写入者")
	}
	disks, err := m.disks.Acquire(id, s.Spec.Disks.InstanceID)
	if err != nil {
		return s, err
	}
	var token [16]byte
	if _, err := rand.Read(token[:]); err != nil {
		return s, err
	}
	s.Lease = disks.Lease
	s.BootID = hex.EncodeToString(token[:])
	s.Generation = generation
	s.Phase = "starting"
	if err := m.save(s); err != nil {
		return s, err
	}
	launch := Launch{Maintenance: maintenance, ID: s.ID, BootID: s.BootID, Disks: disks, VCPUs: s.Spec.VCPUs, CPUMillis: s.Spec.CPUMillis, MemoryMiB: s.Spec.MemoryMiB, Binding: guest.Binding{EnvironmentID: id, InstanceID: s.Spec.Disks.InstanceID, BootID: s.BootID}}
	if err := m.host.Start(ctx, launch); err != nil {
		s.Phase = "failed"
		return s, errors.Join(err, m.save(s))
	}
	running, err = m.host.Running(ctx, s.ID)
	if err != nil || !running {
		s.Phase = "failed"
		return s, errors.Join(errors.New("未确认虚拟机已运行"), err, m.save(s))
	}
	s.Phase = "running"
	if maintenance {
		s.Phase = "maintenance"
	}
	return s, m.save(s)
}
func (m *Manager) Stop(ctx context.Context, id string, generation int64) (State, error) {
	unlock, err := m.lock(id)
	if err != nil {
		return State{}, err
	}
	defer unlock()
	s, err := m.load(id)
	if err != nil {
		return State{}, err
	}
	if generation < s.Generation {
		return s, errors.New("停止代次已过期")
	}
	if s.Phase == "retained" {
		return s, errors.New("环境已经删除并保留数据")
	}
	s.Generation = generation
	s.Phase = "stopping"
	if err := m.save(s); err != nil {
		return s, errors.Join(err, m.host.Stop(ctx, s.ID))
	}
	if err := m.host.Stop(ctx, s.ID); err != nil {
		return s, err
	}
	running, err := m.host.Running(ctx, s.ID)
	if err != nil {
		return s, err
	}
	if running {
		return s, errors.New("尚未确认虚拟机已退出")
	}
	if s.Lease != "" {
		if err := m.disks.Release(ctx, id, s.Spec.Disks.InstanceID, s.Lease, func(ctx context.Context) (bool, error) {
			running, err := m.host.Running(ctx, s.ID)
			return !running, err
		}); err != nil {
			return s, err
		}
	}
	s.Lease = ""
	s.Phase = "stopped"
	return s, m.save(s)
}
func (m *Manager) Protect(ctx context.Context, id string) (State, error) {
	unlock, err := m.lock(id)
	if err != nil {
		return State{}, err
	}
	defer unlock()
	s, err := m.load(id)
	if err != nil {
		return State{}, err
	}
	if s.Phase != "running" && s.Phase != "starting" && s.Phase != "paused" && s.Phase != "maintenance" && s.Phase != "failed" && s.Phase != "stopping" {
		return s, nil
	}
	if s.ProtectionGeneration == 0 {
		var random [16]byte
		if _, err := rand.Read(random[:]); err != nil {
			return s, err
		}
		eventID := fmt.Sprintf("%x-%x-%x-%x-%x", random[0:4], random[4:6], random[6:8], random[8:10], random[10:16])
		s.Protection = &lifecycle.Protection{ID: eventID, At: time.Now().UTC(), Generation: s.Generation, Reason: "storage_pressure"}
	}
	s.ProtectionGeneration = s.Generation
	// 先保存锁定，即使暂停失败或Runner崩溃也不能被旧running目标拉起。
	// 元数据空间耗尽时仍需阻止继续写盘；保留占用，不把此失败宣称为已确认停止。
	if err := m.save(s); err != nil {
		return s, errors.Join(err, m.host.Stop(ctx, s.ID))
	}
	if err := m.host.Pause(ctx, s.ID); err != nil {
		return s, errors.Join(fmt.Errorf("保护暂停失败: %w", err), m.host.Stop(ctx, s.ID))
	}
	s.Phase = "paused"
	return s, m.save(s)
}
func (m *Manager) ClearProtection(ctx context.Context, id string, generation int64, admit func(context.Context) error) error {
	unlock, err := m.lock(id)
	if err != nil {
		return err
	}
	defer unlock()
	s, err := m.load(id)
	if err != nil {
		return err
	}
	if s.ProtectionGeneration == 0 || generation <= s.Generation || s.Phase != "stopped" || admit == nil {
		return errors.New("解除保护需要已停止、更高代次及重新准入")
	}
	if err := admit(ctx); err != nil {
		return err
	}
	s.ProtectionGeneration = 0
	// 不推进目标代次，随后同一显式启动操作仍需满足严格更高代次。
	return m.save(s)
}
func (m *Manager) Retain(ctx context.Context, id string, generation int64) (State, error) {
	unlock, err := m.lock(id)
	if err != nil {
		return State{}, err
	}
	defer unlock()
	s, err := m.load(id)
	if err != nil {
		return State{}, err
	}
	if generation < s.Generation {
		return s, errors.New("删除代次已过期")
	}
	if s.Phase == "retained" {
		return s, nil
	}
	if s.Phase != "stopped" || s.Lease != "" {
		return s, errors.New("删除前必须确认停止并释放磁盘写入者")
	}
	running, err := m.host.Running(ctx, s.ID)
	if err != nil {
		return s, err
	}
	if running {
		return s, errors.New("虚拟机仍在运行")
	}
	if err := m.host.Remove(ctx, s.ID); err != nil {
		return s, err
	}
	if err := m.disks.Retain(id, s.Spec.Disks.InstanceID); err != nil {
		return s, err
	}
	s.Phase = "retained"
	s.Generation = generation
	return s, m.save(s)
}
func (m *Manager) Inspect(ctx context.Context, id string) (State, error) {
	unlock, err := m.lock(id)
	if err != nil {
		return State{}, err
	}
	defer unlock()
	s, err := m.load(id)
	if err != nil {
		return s, err
	}
	if s.Phase == "running" || s.Phase == "maintenance" {
		running, err := m.host.Running(ctx, s.ID)
		if err != nil {
			return s, err
		}
		if !running {
			return s, errors.New("虚拟机异常退出")
		}
	}
	return s, nil
}
