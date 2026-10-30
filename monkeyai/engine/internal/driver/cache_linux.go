package driver

import (
	"context"
	"errors"
	"path/filepath"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/cache"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/containerd/containerd/v2/core/images"
)

const cacheOwner = "io.monkeyai.cache"
const cacheUsed = "io.monkeyai.cache.used"

type imageCache struct {
	driver *Driver
	keep   string
}

func (s imageCache) Usage(ctx context.Context) (cache.Usage, error) {
	return cache.Disk(ctx, cache.Root)
}
func (s imageCache) Images(ctx context.Context) ([]cache.Image, error) {
	pinned, err := (lifecycle.FileStore{Root: filepath.Join(filepath.Dir(s.driver.root), "states")}).Images()
	if err != nil {
		return nil, err
	}
	containers, err := s.driver.client.Containers(ctx)
	if err != nil {
		return nil, err
	}
	for _, container := range containers {
		info, err := container.Info(ctx)
		if err != nil {
			return nil, err
		}
		pinned[info.Image] = true
	}
	list, err := s.driver.client.ImageService().List(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]cache.Image, 0, len(list))
	for _, i := range list {
		managed := i.Labels[cacheOwner] == "1"
		used := i.CreatedAt
		if managed {
			used, err = time.Parse(time.RFC3339Nano, i.Labels[cacheUsed])
			if err != nil || used.After(time.Now().Add(time.Minute)) {
				return nil, errors.New("缓存镜像最近使用记录无效")
			}
		}
		out = append(out, cache.Image{Name: i.Name, Target: i.Target.Digest.String(), UsedAt: used, Managed: managed, Pinned: pinned[i.Name] || i.Name == s.keep})
	}
	return out, nil
}
func (s imageCache) Delete(ctx context.Context, want cache.Image) error {
	// 重新核对刚进入准备阶段的实例，不根据过期列表回收。
	list, err := s.Images(ctx)
	if err != nil {
		return err
	}
	for _, i := range list {
		if i.Name != want.Name {
			continue
		}
		if !i.Managed || i.Pinned || i.Target != want.Target || !i.UsedAt.Equal(want.UsedAt) {
			return errors.New("镜像归属、引用或最近使用记录已改变，拒绝回收")
		}
		return s.driver.client.ImageService().Delete(ctx, i.Name, images.SynchronousDelete())
	}
	return nil
}
func (d *Driver) cacheLock() (func(), error) {
	return control.Lock(filepath.Join(d.root, "images.lock"))
}
func (d *Driver) Cache(ctx context.Context, prune bool) (cache.Report, error) {
	ctx, cancel := context.WithTimeout(d.context(ctx), 2*time.Minute)
	defer cancel()
	unlock, err := d.cacheLock()
	if err != nil {
		return cache.Report{}, err
	}
	defer unlock()
	c, err := cache.Read(cache.ConfigPath)
	if err != nil {
		return cache.Report{}, err
	}
	store := imageCache{driver: d}
	if prune {
		return cache.Reclaim(ctx, store, c, true)
	}
	return cache.Inspect(ctx, store, c)
}
