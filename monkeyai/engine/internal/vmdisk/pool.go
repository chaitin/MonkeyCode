package vmdisk

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

type Reservation struct {
	LogicalBytes  int64 `json:"logical_bytes"`
	PhysicalBytes int64 `json:"physical_bytes"`
	Committed     bool  `json:"committed"`
}
type Pool struct {
	root, path string
	limit      int64
	policy     PressurePolicy
	capacity   func(string) (Capacity, error)
}

func NewPool(stateRoot, dataRoot string, logicalLimit int64, policy PressurePolicy) (*Pool, error) {
	if !filepath.IsAbs(stateRoot) || filepath.Clean(stateRoot) != stateRoot || stateRoot == "/" || !filepath.IsAbs(dataRoot) || filepath.Clean(dataRoot) != dataRoot || dataRoot == "/" || logicalLimit <= 0 {
		return nil, errors.New("存储池目录或逻辑上限无效")
	}
	if err := policy.Validate(); err != nil {
		return nil, err
	}
	if err := storage.PrivateDir(stateRoot); err != nil {
		return nil, err
	}
	return &Pool{root: stateRoot, path: dataRoot, limit: logicalLimit, policy: policy, capacity: ReadCapacity}, nil
}
func (p *Pool) lock() (func(), error) { return control.Lock(filepath.Join(p.root, "capacity.lock")) }
func (p *Pool) load() (map[string]Reservation, error) {
	path := filepath.Join(p.root, "reservations.json")
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]Reservation{}, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 8<<20 {
		return nil, errors.New("存储容量记录无效")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var all map[string]Reservation
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&all) != nil || decoder.Decode(new(any)) != io.EOF || all == nil {
		return nil, errors.New("存储容量记录损坏")
	}
	for id, r := range all {
		if id == "" || len(id) > 256 || r.LogicalBytes <= 0 || r.PhysicalBytes < 0 || r.Committed && r.PhysicalBytes != 0 {
			return nil, errors.New("存储容量记录不一致")
		}
	}
	return all, nil
}
func (p *Pool) save(all map[string]Reservation) error {
	raw, err := json.Marshal(all)
	if err != nil {
		return err
	}
	return control.Write(filepath.Join(p.root, "reservations.json"), raw, 0600)
}

// Reserve 同时对逻辑上限和物理准备预算准入，未完成预留在重启后继续保留。
func (p *Pool) Reserve(ctx context.Context, id string, logical, physical int64) error {
	if id == "" || len(id) > 256 || logical <= 0 || physical <= 0 {
		return errors.New("存储预留参数无效")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	unlock, err := p.lock()
	if err != nil {
		return err
	}
	defer unlock()
	all, err := p.load()
	if err != nil {
		return err
	}
	if old, ok := all[id]; ok {
		if old.LogicalBytes != logical || !old.Committed && old.PhysicalBytes != physical {
			return errors.New("同一环境重复预留内容不一致")
		}
		return nil
	}
	var logicalUsed, physicalUsed int64
	for _, r := range all {
		if r.LogicalBytes > p.limit-logicalUsed {
			return errors.New("既有逻辑分配已达到上限")
		}
		logicalUsed += r.LogicalBytes
		if r.PhysicalBytes > 1<<60-physicalUsed {
			return errors.New("物理准备预算累计溢出")
		}
		physicalUsed += r.PhysicalBytes
	}
	if logical > p.limit-logicalUsed {
		return errors.New("磁盘逻辑超卖总额超出上限")
	}
	capacity, err := p.capacity(p.path)
	if err != nil {
		return err
	}
	if err := p.policy.Admit(capacity, PressureNormal, physicalUsed, physical); err != nil {
		return err
	}
	all[id] = Reservation{LogicalBytes: logical, PhysicalBytes: physical}
	return p.save(all)
}

// Commit 仅由已完成初始化、确认真实落盘的操作调用；逻辑容量继续占用。
func (p *Pool) Commit(id string) error {
	unlock, err := p.lock()
	if err != nil {
		return err
	}
	defer unlock()
	all, err := p.load()
	if err != nil {
		return err
	}
	r, ok := all[id]
	if !ok {
		return errors.New("容量预留不存在")
	}
	r.PhysicalBytes = 0
	r.Committed = true
	all[id] = r
	return p.save(all)
}

// Release 只在调用方确认文件和句柄已清理后使用。停止或删除但保留数据不能释放。
func (p *Pool) Release(ctx context.Context, id string, removed func(context.Context) (bool, error)) error {
	if removed == nil {
		return errors.New("释放容量必须确认数据已回收")
	}
	unlock, err := p.lock()
	if err != nil {
		return err
	}
	defer unlock()
	all, err := p.load()
	if err != nil {
		return err
	}
	if _, ok := all[id]; !ok {
		return nil
	}
	ok, err := removed(ctx)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("尚未确认磁盘空间回收")
	}
	delete(all, id)
	return p.save(all)
}
