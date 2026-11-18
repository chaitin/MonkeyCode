package vmdisk

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

type Spec struct {
	EnvironmentID string `json:"environment_id"`
	InstanceID    string `json:"instance_id"`
	TemplateID    string `json:"template_id"`
	DiskBytes     int64  `json:"disk_bytes"`
}

type Disk struct {
	Spec      Spec      `json:"spec"`
	Path      string    `json:"path"`
	State     string    `json:"state"`
	Lease     string    `json:"lease,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// Stopped 必须从宿主确认 VMM 已退出，不能信任虚拟机的自报状态。
type Stopped func(context.Context) (bool, error)

type Manager struct {
	root string
}

func New(root string) (*Manager, error) {
	if !filepath.IsAbs(root) || filepath.Clean(root) != root || root == "/" {
		return nil, errors.New("磁盘目录必须为绝对路径")
	}
	if err := storage.PrivateDir(root); err != nil {
		return nil, err
	}
	for _, name := range []string{"disks", "records", "locks"} {
		if err := storage.PrivateDir(filepath.Join(root, name)); err != nil {
			return nil, err
		}
	}
	return &Manager{root: root}, nil
}

func (s Spec) validate() error {
	if s.EnvironmentID == "" || s.InstanceID == "" || s.TemplateID == "" || len(s.EnvironmentID) > 256 || len(s.InstanceID) > 256 || len(s.TemplateID) > 256 {
		return errors.New("缺少磁盘所有者或模板标识")
	}
	if s.DiskBytes < 64<<20 || s.DiskBytes > 16<<40 || s.DiskBytes%4096 != 0 {
		return errors.New("磁盘容量须介于64MiB和16TiB之间且按4KiB对齐")
	}
	return nil
}

func (m *Manager) location(id string) string {
	return filepath.Join(m.root, "disks", storage.Key(id))
}

func (m *Manager) record(id string) string {
	return filepath.Join(m.root, "records", storage.Key(id)+".json")
}

func (m *Manager) lock(id string) (func(), error) {
	return control.Lock(filepath.Join(m.root, "locks", storage.Key(id)+".lock"))
}

func (m *Manager) Ensure(ctx context.Context, spec Spec, template string) (Disk, error) {
	if err := spec.validate(); err != nil {
		return Disk{}, err
	}
	unlock, err := m.lock(spec.EnvironmentID)
	if err != nil {
		return Disk{}, err
	}
	defer unlock()
	disks, err := m.load(spec.EnvironmentID)
	if err == nil {
		if disks.Spec != spec || disks.State != "ready" {
			return Disk{}, errors.New("已有磁盘所有者、模板、容量或状态不匹配")
		}
		return disks, m.verify(disks)
	}
	if !errors.Is(err, os.ErrNotExist) {
		return Disk{}, err
	}
	target := m.location(spec.EnvironmentID)
	if _, err := os.Lstat(target); !errors.Is(err, os.ErrNotExist) {
		return Disk{}, errors.New("磁盘目录已存在或无法检查，拒绝重建")
	}
	info, err := os.Lstat(template)
	if err != nil {
		return Disk{}, err
	}
	if !info.Mode().IsRegular() || info.Size() != spec.DiskBytes {
		return Disk{}, errors.New("模板类型或容量不匹配")
	}
	if err := ctx.Err(); err != nil {
		return Disk{}, err
	}
	disks = Disk{Spec: spec, Path: filepath.Join(target, "disk.ext4"), State: "preparing", CreatedAt: time.Now().UTC()}
	// 独立登记创建意图；磁盘目录丢失或进程中断后不能悄悄重建用户数据。
	if err := m.save(disks); err != nil {
		return Disk{}, err
	}
	stage, err := os.MkdirTemp(filepath.Join(m.root, "disks"), ".prepare-")
	if err != nil {
		return Disk{}, err
	}
	defer os.RemoveAll(stage)
	if err := Copy(ctx, template, filepath.Join(stage, "disk.ext4")); err != nil {
		return Disk{}, err
	}
	if err := verifyFile(filepath.Join(stage, "disk.ext4"), spec.DiskBytes); err != nil {
		return Disk{}, err
	}
	if err := syncDir(stage); err != nil {
		return Disk{}, err
	}
	if err := ctx.Err(); err != nil {
		return Disk{}, err
	}
	if err := os.Rename(stage, target); err != nil {
		return Disk{}, err
	}
	if err := syncDir(filepath.Dir(target)); err != nil {
		return Disk{}, err
	}
	disks.State = "ready"
	if err := m.save(disks); err != nil {
		return Disk{}, err
	}
	return disks, nil
}

func (m *Manager) Load(id string) (Disk, error) {
	unlock, err := m.lock(id)
	if err != nil {
		return Disk{}, err
	}
	defer unlock()
	d, err := m.load(id)
	if err != nil {
		return Disk{}, err
	}
	if d.State == "ready" || d.State == "retained" {
		err = m.verify(d)
	}
	return d, err
}

// Acquire 在启动 VMM 前持久化占用。Runner 重启不会清除占用。
func (m *Manager) Acquire(id, instance string) (Disk, error) {
	unlock, err := m.lock(id)
	if err != nil {
		return Disk{}, err
	}
	defer unlock()
	d, err := m.owned(id, instance)
	if err != nil {
		return Disk{}, err
	}
	if d.State != "ready" || d.Lease != "" {
		return Disk{}, errors.New("磁盘不可挂载或仍有未确认退出的写入者")
	}
	if err := m.verify(d); err != nil {
		return Disk{}, err
	}
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return Disk{}, err
	}
	d.Lease = hex.EncodeToString(token[:])
	return d, m.save(d)
}

// Release 同时用于正常停止和崩溃恢复，调用方必须提供宿主进程身份核验。
func (m *Manager) Release(ctx context.Context, id, instance, lease string, stopped Stopped) error {
	unlock, err := m.lock(id)
	if err != nil {
		return err
	}
	defer unlock()
	d, err := m.owned(id, instance)
	if err != nil {
		return err
	}
	if lease == "" || d.Lease != lease || stopped == nil || d.State != "ready" {
		return errors.New("磁盘占用凭据或停止确认无效")
	}
	ok, err := stopped(ctx)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("尚未确认宿主 VMM 已退出")
	}
	d.Lease = ""
	return m.save(d)
}

func (m *Manager) Retain(id, instance string) error {
	unlock, err := m.lock(id)
	if err != nil {
		return err
	}
	defer unlock()
	d, err := m.owned(id, instance)
	if err != nil {
		return err
	}
	if d.Lease != "" || (d.State != "ready" && d.State != "retained") {
		return errors.New("占用中或状态不明的磁盘不能转为保留状态")
	}
	if err := m.verify(d); err != nil {
		return err
	}
	d.State = "retained"
	return m.save(d)
}

func (m *Manager) Destroy(id, instance string, confirmed bool) error {
	if !confirmed {
		return errors.New("永久销毁磁盘需要明确确认")
	}
	unlock, err := m.lock(id)
	if err != nil {
		return err
	}
	defer unlock()
	d, err := m.owned(id, instance)
	if err != nil {
		return err
	}
	if d.Lease != "" || (d.State != "retained" && d.State != "destroying" && d.State != "destroyed") {
		return errors.New("仅可销毁无写入者的保留磁盘")
	}
	if d.State == "destroyed" {
		return nil
	}
	d.State = "destroying"
	if err := m.save(d); err != nil {
		return err
	}
	if err := os.RemoveAll(m.location(id)); err != nil {
		return err
	}
	if err := syncDir(filepath.Join(m.root, "disks")); err != nil {
		return err
	}
	d.State = "destroyed"
	return m.save(d)
}

func (m *Manager) owned(id, instance string) (Disk, error) {
	d, err := m.load(id)
	if err == nil && d.Spec.InstanceID != instance {
		err = errors.New("磁盘所有者不匹配")
	}
	return d, err
}

func (m *Manager) load(id string) (Disk, error) {
	file := m.record(id)
	info, err := os.Lstat(file)
	if err != nil {
		return Disk{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > 64<<10 || info.Mode().Perm()&0077 != 0 {
		return Disk{}, errors.New("磁盘登记文件类型、权限或大小异常")
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		return Disk{}, err
	}
	var d Disk
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&d); err != nil {
		return Disk{}, err
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return Disk{}, errors.New("磁盘登记文件包含多余内容")
	}
	if err := d.Spec.validate(); err != nil {
		return Disk{}, err
	}
	path := m.location(id)
	if d.Spec.EnvironmentID != id || d.Path != filepath.Join(path, "disk.ext4") || d.CreatedAt.IsZero() {
		return Disk{}, errors.New("磁盘登记文件身份或路径异常")
	}
	switch d.State {
	case "preparing", "ready", "retained", "destroying", "destroyed":
	default:
		return Disk{}, errors.New("磁盘登记文件状态未知")
	}
	if d.Lease != "" {
		token, err := hex.DecodeString(d.Lease)
		if err != nil || len(token) != 32 || d.State != "ready" {
			return Disk{}, errors.New("磁盘占用登记异常")
		}
	}
	return d, nil
}

func (m *Manager) verify(d Disk) error {
	dir := m.location(d.Spec.EnvironmentID)
	info, err := os.Lstat(dir)
	if err != nil {
		return fmt.Errorf("已有磁盘目录缺失，禁止重建: %v", err)
	}
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil || resolved != dir || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return fmt.Errorf("磁盘目录不是私有真实目录: %s", dir)
	}
	if err := verifyFile(d.Path, d.Spec.DiskBytes); err != nil {
		// 不向调用者泄漏ErrNotExist，防止误当成首次创建。
		return fmt.Errorf("已有磁盘损坏或缺失，禁止重建: %v", err)
	}
	return nil
}

func verifyFile(path string, size int64) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != size || info.Mode().Perm()&0077 != 0 {
		return errors.New("磁盘类型、容量或权限异常")
	}
	return nil
}

func (m *Manager) save(d Disk) error {
	raw, err := json.Marshal(d)
	if err != nil {
		return err
	}
	return control.Write(m.record(d.Spec.EnvironmentID), raw, 0600)
}

func syncDir(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
