package cache

import (
	"context"
	"errors"
	"sort"
	"time"
)

const Root = "/var/lib/monkeyai-engine/containerd"
const ConfigPath = "/etc/monkeyai-engine/cache.json"
const ReserveBytes = int64(25 << 30)
const ReserveInodes = uint64(1100000)

type Config struct {
	MaxBytes      int64  `json:"max_bytes"`
	MinFreeBytes  int64  `json:"min_free_bytes"`
	MinFreeInodes uint64 `json:"min_free_inodes"`
}

func DefaultConfig() Config { return Config{64 << 30, 8 << 30, 100000} }
func (c Config) Validate() error {
	if c.MaxBytes < 32<<30 || c.MaxBytes > 4<<40 || c.MinFreeBytes < 1<<30 || c.MinFreeBytes > 4<<40 || c.MinFreeInodes < 10000 || c.MinFreeInodes > 10000000 {
		return errors.New("镜像缓存预算或磁盘安全余量无效")
	}
	return nil
}

type Usage struct {
	Bytes      int64  `json:"bytes"`
	FreeBytes  int64  `json:"free_bytes"`
	FreeInodes uint64 `json:"free_inodes"`
}
type Image struct {
	Name    string    `json:"name"`
	Target  string    `json:"target"`
	UsedAt  time.Time `json:"used_at"`
	Managed bool      `json:"managed"`
	Pinned  bool      `json:"pinned"`
}
type Store interface {
	Usage(context.Context) (Usage, error)
	Images(context.Context) ([]Image, error)
	Delete(context.Context, Image) error
}
type Report struct {
	Config  Config   `json:"config"`
	Usage   Usage    `json:"usage"`
	Images  []Image  `json:"images"`
	Deleted []string `json:"deleted"`
	Ready   bool     `json:"ready"`
}

func available(c Config, u Usage, reserve bool) bool {
	bytes, inodes := int64(0), uint64(0)
	if reserve {
		bytes, inodes = ReserveBytes, ReserveInodes
	}
	return u.Bytes >= 0 && u.FreeBytes >= 0 && u.Bytes <= c.MaxBytes-bytes && u.FreeBytes >= c.MinFreeBytes+bytes && u.FreeInodes >= c.MinFreeInodes+inodes
}
func Inspect(ctx context.Context, s Store, c Config) (Report, error) {
	r := Report{Config: c, Deleted: []string{}}
	if err := c.Validate(); err != nil {
		return r, err
	}
	var err error
	r.Usage, err = s.Usage(ctx)
	if err != nil {
		return r, err
	}
	r.Images, err = s.Images(ctx)
	if err != nil {
		return r, err
	}
	r.Ready = available(c, r.Usage, true)
	return r, nil
}

// Reclaim 的调用方持有与镜像准备共用的跨进程锁；每次删除后重新读取实际空间。
func Reclaim(ctx context.Context, s Store, c Config, reserve bool) (Report, error) {
	r, err := Inspect(ctx, s, c)
	if err != nil {
		return r, err
	}
	candidates := append([]Image(nil), r.Images...)
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].UsedAt.Equal(candidates[j].UsedAt) {
			return candidates[i].Name < candidates[j].Name
		}
		return candidates[i].UsedAt.Before(candidates[j].UsedAt)
	})
	for _, image := range candidates {
		if available(c, r.Usage, reserve) {
			break
		}
		if err := ctx.Err(); err != nil {
			return r, err
		}
		if !image.Managed || image.Pinned {
			continue
		}
		if err := s.Delete(ctx, image); err != nil {
			return r, err
		}
		r.Deleted = append(r.Deleted, image.Name)
		r.Usage, err = s.Usage(ctx)
		if err != nil {
			return r, err
		}
	}
	if len(r.Deleted) > 0 {
		r.Images, err = s.Images(ctx)
		if err != nil {
			return r, err
		}
	}
	r.Ready = available(c, r.Usage, true)
	if !available(c, r.Usage, reserve) {
		return r, errors.New("镜像缓存预算、磁盘空间或 inode 不足；不回收活跃环境和未知镜像")
	}
	return r, nil
}
