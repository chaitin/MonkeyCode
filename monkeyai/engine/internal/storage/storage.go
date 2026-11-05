package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

type Mount struct{ Source, Target string }
type Record struct {
	Environment string           `json:"environment"`
	Volume      lifecycle.Volume `json:"volume"`
	Project     uint32           `json:"project,omitempty"`
	Ready       bool             `json:"ready"`
}

type Manager struct{ root string }

func Key(id string) string { sum := sha256.Sum256([]byte(id)); return hex.EncodeToString(sum[:]) }
func New(root string) (*Manager, error) {
	if !filepath.IsAbs(root) || filepath.Clean(root) != root || root == "/" {
		return nil, errors.New("存储根目录无效")
	}
	return &Manager{root: root}, nil
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
func (m *Manager) Ensure(_ context.Context, s lifecycle.Spec) ([]Mount, error) {
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
			return nil, errors.New("卷映射损坏，拒绝接管已有目录")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	} else {
		entries, e := os.ReadDir(filepath.Join(m.root, "volumes"))
		if e != nil && !errors.Is(e, os.ErrNotExist) {
			return nil, e
		}
		if len(entries) > 0 {
			return nil, errors.New("已有卷目录但映射丢失，拒绝接管已有目录")
		}
	}
	for id, r := range records {
		if id != r.Volume.ID || r.Environment == "" || r.Volume.Target() == "" {
			return nil, errors.New("卷映射不一致")
		}
	}
	// 先核对所有绑定，避免部分修改后才发现其他卷属于别的环境。
	for _, v := range s.Volumes {
		if r, ok := records[v.ID]; ok {
			if r.Environment != s.EnvironmentID || r.Volume.Purpose != v.Purpose {
				return nil, errors.New("卷已被其他环境绑定或用途不同")
			}
			if r.Project != 0 {
				return nil, errors.New("此卷带有旧版项目配额；请先迁移到普通目录，数据保持不变")
			}
		}
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
			r = Record{Environment: s.EnvironmentID, Volume: v}
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
		if !r.Ready {
			entries, err := os.ReadDir(dir)
			if err != nil {
				return nil, err
			}
			if len(entries) != 0 {
				return nil, errors.New("未就绪卷目录不为空，拒绝接管已有数据")
			}
		}
		if err := prepare(dir); err != nil {
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
