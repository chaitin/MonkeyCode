package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

type Mount struct{ Source, Target string }
type Record struct {
	Environment string           `json:"environment"`
	Volume      lifecycle.Volume `json:"volume"`
	Project     uint32           `json:"project"`
	Ready       bool             `json:"ready"`
}

// Quota 设置只针对已绑定到当前管理目录的 project ID。
type Quota interface {
	Check(context.Context, string) error
	Available(context.Context, string, uint32) (bool, error)
	Reserve(context.Context, string, int64, int64) error
	Assign(context.Context, string, uint32) error
	Limit(context.Context, string, uint32, int64, int64) error
}
type Manager struct {
	root  string
	quota Quota
}

func Key(id string) string { sum := sha256.Sum256([]byte(id)); return hex.EncodeToString(sum[:]) }
func New(root string, quota Quota) (*Manager, error) {
	if quota == nil {
		return nil, errors.New("配额实现不能为空")
	}
	if !filepath.IsAbs(root) || filepath.Clean(root) != root || root == "/" {
		return nil, errors.New("存储根目录无效")
	}
	return &Manager{root: root, quota: quota}, nil
}
func PrivateDir(path string) error {
	if err := os.MkdirAll(path, 0700); err != nil {
		return err
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return errors.New("管理目录不能包含符号链接")
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return errors.New("管理目录必须为 0700")
	}
	return nil
}
func (m *Manager) Ensure(ctx context.Context, s lifecycle.Spec) ([]Mount, error) {
	if err := s.Validate(); err != nil {
		return nil, err
	}
	if err := PrivateDir(m.root); err != nil {
		return nil, err
	}
	unlock, err := control.Lock(filepath.Join(m.root, "volumes.lock"))
	if err != nil {
		return nil, err
	}
	defer unlock()
	if err := m.quota.Check(ctx, m.root); err != nil {
		return nil, err
	}
	registry := filepath.Join(m.root, "volumes.json")
	records := map[string]Record{}
	if info, err := os.Lstat(registry); err == nil {
		if !info.Mode().IsRegular() || info.Size() > 16<<20 {
			return nil, errors.New("卷映射类型或大小无效")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	raw, err := os.ReadFile(registry)
	if err == nil {
		if err = json.Unmarshal(raw, &records); err != nil || records == nil {
			return nil, errors.New("卷映射损坏，拒绝分配项目 ID")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	} else {
		entries, e := os.ReadDir(filepath.Join(m.root, "volumes"))
		if e != nil && !errors.Is(e, os.ErrNotExist) {
			return nil, e
		}
		if len(entries) > 0 {
			return nil, errors.New("已有卷目录但映射丢失，拒绝重新分配项目 ID")
		}
	}
	next := uint32(10000)
	seen := map[uint32]bool{}
	for id, r := range records {
		if id != r.Volume.ID || r.Project < 10000 || r.Project >= 1<<31 || r.Environment == "" || seen[r.Project] {
			return nil, errors.New("卷映射不一致")
		}
		seen[r.Project] = true
		if r.Project >= next {
			next = r.Project + 1
		}
	}
	// 先核对所有绑定，避免部分修改后才发现其他卷属于别的环境。
	for _, v := range s.Volumes {
		if r, ok := records[v.ID]; ok && (r.Environment != s.EnvironmentID || r.Volume.Purpose != v.Purpose || v.Bytes < r.Volume.Bytes || v.Inodes < r.Volume.Inodes) {
			return nil, errors.New("卷已被其他环境绑定、用途不同或请求缩容")
		}
	}
	var total, delta int64
	for _, r := range records {
		if r.Volume.Bytes < 64<<20 || r.Volume.Bytes > 16<<40 || total > (1<<60)-r.Volume.Bytes {
			return nil, errors.New("卷配额记录无效")
		}
		total += r.Volume.Bytes
	}
	for _, v := range s.Volumes {
		delta += v.Bytes - records[v.ID].Volume.Bytes
	}
	if err := m.quota.Reserve(ctx, m.root, total+delta, delta); err != nil {
		return nil, err
	}
	save := func() error {
		b, err := json.Marshal(records)
		if err != nil {
			return err
		}
		return control.Write(registry, b, 0600)
	}
	mounts := make([]Mount, 0, 3)
	for _, v := range s.Volumes {
		r, ok := records[v.ID]
		if !ok {
			if next >= 1<<31 {
				return nil, errors.New("项目配额 ID 已耗尽")
			}
			available, err := m.quota.Available(ctx, m.root, next)
			if err != nil {
				return nil, err
			}
			if !available {
				return nil, errors.New("待分配项目 ID 已有配额或数据；数据盘必须由当前 engine 独占管理")
			}
			r = Record{Environment: s.EnvironmentID, Volume: v, Project: next}
			next++
			records[v.ID] = r
			if err := save(); err != nil {
				return nil, err
			}
		}
		dir := filepath.Join(m.root, "volumes", Key(v.ID))
		if err := PrivateDir(filepath.Dir(dir)); err != nil {
			return nil, err
		}
		if !r.Ready {
			if err := os.Mkdir(dir, 0700); err != nil && !errors.Is(err, os.ErrExist) {
				return nil, err
			}
		}
		info, err := os.Lstat(dir)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("持久卷缺失或不是普通目录")
		}
		if err := m.quota.Assign(ctx, dir, r.Project); err != nil {
			return nil, fmt.Errorf("绑定卷配额: %w", err)
		}
		if err := m.quota.Limit(ctx, m.root, r.Project, v.Bytes, v.Inodes); err != nil {
			return nil, err
		}
		r.Volume = v
		r.Ready = true
		records[v.ID] = r
		if err := save(); err != nil {
			return nil, err
		}
		mounts = append(mounts, Mount{dir, v.Target()})
	}
	return mounts, nil
}
