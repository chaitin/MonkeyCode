package network

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

type binding struct {
	EnvironmentID string     `json:"environment_id"`
	InstanceID    string     `json:"instance_id"`
	Config        Config     `json:"config"`
	NamespaceID   uint64     `json:"namespace_id"`
	Stage         string     `json:"stage"`
	Connection    Connection `json:"connection"`
}

func (b binding) name() string {
	return "mae-" + storage.Key(b.EnvironmentID + "\n" + b.InstanceID)[:24]
}
func (b binding) path() string { return "/run/netns/" + b.name() }

type kernel interface {
	Create(context.Context, binding) (uint64, error)
	Attach(context.Context, binding) (Connection, error)
	Guard(context.Context, binding) error
	Detach(context.Context, binding) error
	Delete(context.Context, binding) error
}
type Attachment struct {
	Namespace string
	Resolver  string
}
type Manager struct {
	root   string
	kernel kernel
	read   func() (Config, error)
}

func New(root string) *Manager {
	return &Manager{root: root, kernel: local{}, read: func() (Config, error) { return Read(ConfigPath) }}
}
func (m *Manager) lock() (func(), error) {
	if err := storage.PrivateDir(m.root); err != nil {
		return nil, err
	}
	return control.Lock(filepath.Join(m.root, "network.lock"))
}
func (m *Manager) load(s lifecycle.Spec) (binding, error) {
	b := binding{EnvironmentID: s.EnvironmentID, InstanceID: s.InstanceID}
	path := filepath.Join(m.root, b.name()+".json")
	info, err := os.Lstat(path)
	if err != nil {
		return b, err
	}
	if !info.Mode().IsRegular() || info.Size() > 64<<10 {
		return b, errors.New("网络绑定记录类型或大小无效")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return b, err
	}
	var saved binding
	if json.Unmarshal(raw, &saved) != nil || saved.EnvironmentID != b.EnvironmentID || saved.InstanceID != b.InstanceID || saved.Config.Validate() != nil {
		return b, errors.New("网络绑定损坏或归属不一致")
	}
	switch saved.Stage {
	case "planned", "namespace", "attaching", "attached", "ready", "removing", "removed":
	default:
		return b, errors.New("网络绑定阶段无效")
	}
	if saved.Stage != "planned" && saved.Stage != "removed" && saved.NamespaceID == 0 {
		return b, errors.New("网络命名空间身份缺失")
	}
	if (saved.Stage == "attached" || saved.Stage == "ready" || saved.Connection != (Connection{})) && !saved.Connection.validate(saved.Config) {
		return b, errors.New("网络连接记录无效")
	}
	return saved, nil
}
func (m *Manager) save(b binding) error {
	raw, err := json.Marshal(b)
	if err != nil {
		return err
	}
	return control.Write(filepath.Join(m.root, b.name()+".json"), raw, 0600)
}
func (m *Manager) Ensure(ctx context.Context, s lifecycle.Spec) (Attachment, error) {
	if err := s.Validate(); err != nil {
		return Attachment{}, err
	}
	if s.NetworkPolicy == "isolated" {
		return Attachment{}, nil
	}
	if s.NetworkPolicy != "public-only" {
		return Attachment{}, errors.New("网络策略无效")
	}
	unlock, err := m.lock()
	if err != nil {
		return Attachment{}, err
	}
	defer unlock()
	b, err := m.load(s)
	if errors.Is(err, os.ErrNotExist) {
		cfg, e := m.read()
		if e != nil {
			return Attachment{}, e
		}
		if err := cfg.Validate(); err != nil {
			return Attachment{}, err
		}
		b.Config = cfg
		b.Stage = "planned"
		if e = m.save(b); e != nil {
			return Attachment{}, e
		}
	} else if err != nil {
		return Attachment{}, err
	}
	if b.Stage == "removed" || b.Stage == "removing" {
		return Attachment{}, errors.New("已回收网络不能复用")
	}
	if b.Stage == "planned" {
		id, e := m.kernel.Create(ctx, b)
		if e != nil {
			return Attachment{}, e
		}
		b.NamespaceID = id
		b.Stage = "namespace"
		if e = m.save(b); e != nil {
			return Attachment{}, e
		}
	}
	if b.Stage == "attaching" {
		if e := m.kernel.Detach(ctx, b); e != nil {
			return Attachment{}, e
		}
		b.Stage = "namespace"
		if e := m.save(b); e != nil {
			return Attachment{}, e
		}
	}
	if b.Stage == "namespace" {
		b.Stage = "attaching"
		if e := m.save(b); e != nil {
			return Attachment{}, e
		}
		connection, e := m.kernel.Attach(ctx, b)
		if e != nil {
			return Attachment{}, e
		}
		if !connection.validate(b.Config) {
			return Attachment{}, errors.New("CNI 返回无效连接")
		}
		b.Connection = connection
		b.Stage = "attached"
		if e = m.save(b); e != nil {
			return Attachment{}, e
		}
	}
	if err := m.kernel.Guard(ctx, b); err != nil {
		return Attachment{}, err
	}
	resolver := filepath.Join(m.root, b.name()+".resolv.conf")
	content := "options timeout:2 attempts:2\n"
	for _, dns := range b.Config.DNS {
		content += "nameserver " + dns + "\n"
	}
	if err := control.Write(resolver, []byte(content), 0644); err != nil {
		return Attachment{}, err
	}
	b.Stage = "ready"
	if err := m.save(b); err != nil {
		return Attachment{}, err
	}
	return Attachment{b.path(), resolver}, nil
}
func (m *Manager) Check(ctx context.Context, s lifecycle.Spec) error {
	if err := s.Validate(); err != nil {
		return err
	}
	if s.NetworkPolicy == "isolated" {
		return nil
	}
	unlock, err := m.lock()
	if err != nil {
		return err
	}
	defer unlock()
	b, err := m.load(s)
	if err != nil {
		return err
	}
	if b.Stage != "ready" {
		return errors.New("网络尚未就绪")
	}
	return m.kernel.Guard(ctx, b)
}
func (m *Manager) Remove(ctx context.Context, s lifecycle.Spec) error {
	if err := s.Validate(); err != nil {
		return err
	}
	if s.NetworkPolicy == "isolated" {
		return nil
	}
	unlock, err := m.lock()
	if err != nil {
		return err
	}
	defer unlock()
	b, err := m.load(s)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if b.Stage == "removed" {
		return nil
	}
	if b.Stage == "planned" {
		// 缺少 inode 证据时只允许清理尚未创建命名空间的计划。
		if err := m.kernel.Delete(ctx, b); err != nil {
			return err
		}
		b.Stage = "removed"
		return m.save(b)
	}
	b.Stage = "removing"
	if err := m.save(b); err != nil {
		return err
	}
	if err := m.kernel.Detach(ctx, b); err != nil {
		return err
	}
	if err := m.kernel.Delete(ctx, b); err != nil {
		return err
	}
	b.Stage = "removed"
	return m.save(b)
}
