package driver

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/cache"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockerapi"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

type cached struct {
	Used    time.Time
	Managed bool
}

func (d *Driver) cacheLock() (func(), error) {
	return control.Lock(filepath.Join(d.root, "images.lock"))
}
func (d *Driver) imageRecords() (map[string]cached, error) {
	out := map[string]cached{}
	raw, err := os.ReadFile(filepath.Join(d.root, "images.json"))
	if errors.Is(err, os.ErrNotExist) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	if len(raw) > 4<<20 {
		return nil, errors.New("镜像记录超过上限")
	}
	err = json.Unmarshal(raw, &out)
	return out, err
}
func (d *Driver) touchImage(name string, managed bool) error {
	m, err := d.imageRecords()
	if err != nil {
		return err
	}
	old := m[name]
	m[name] = cached{time.Now().UTC(), old.Managed || managed}
	raw, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return control.Write(filepath.Join(d.root, "images.json"), raw, 0600)
}

type imageCache struct {
	driver *Driver
	keep   string
}

func (s imageCache) Usage(ctx context.Context) (cache.Usage, error) {
	info, err := s.driver.client.Info(ctx)
	if err != nil {
		return cache.Usage{}, err
	}
	u, err := cache.Space(info.DockerRootDir)
	if err != nil {
		return u, err
	}
	records, err := s.driver.imageRecords()
	if err != nil {
		return u, err
	}
	seen := map[string]bool{}
	for name, r := range records {
		if !r.Managed {
			continue
		}
		var i imageInfo
		err = s.driver.client.Do(ctx, "GET", "/images/"+dockerapi.Escape(name)+"/json", nil, &i)
		if dockerapi.NotFound(err) {
			continue
		}
		if err != nil {
			return u, err
		}
		if !seen[i.ID] {
			u.Bytes += i.Size
			seen[i.ID] = true
		}
	}
	return u, nil
}
func (s imageCache) Images(ctx context.Context) ([]cache.Image, error) {
	records, err := s.driver.imageRecords()
	if err != nil {
		return nil, err
	}
	pinned, err := (lifecycle.FileStore{Root: filepath.Join(filepath.Dir(s.driver.root), "states")}).Images()
	if err != nil {
		return nil, err
	}
	var containers []struct{ Image, ImageID string }
	if err = s.driver.client.Do(ctx, "GET", "/containers/json?all=true", nil, &containers); err != nil {
		return nil, err
	}
	out := []cache.Image{}
	for name, r := range records {
		var i imageInfo
		err = s.driver.client.Do(ctx, "GET", "/images/"+dockerapi.Escape(name)+"/json", nil, &i)
		if dockerapi.NotFound(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		pin := pinned[name] || name == s.keep
		for _, c := range containers {
			pin = pin || c.ImageID == i.ID || c.Image == name
		}
		out = append(out, cache.Image{Name: name, Target: i.ID, UsedAt: r.Used, Managed: r.Managed, Pinned: pin})
	}
	return out, nil
}
func (s imageCache) Delete(ctx context.Context, want cache.Image) error {
	list, err := s.Images(ctx)
	if err != nil {
		return err
	}
	for _, i := range list {
		if i.Name != want.Name {
			continue
		}
		if !i.Managed || i.Pinned || i.Target != want.Target || !i.UsedAt.Equal(want.UsedAt) {
			return errors.New("镜像归属或使用情况已改变，拒绝回收")
		}
		return s.driver.client.Do(ctx, "DELETE", "/images/"+dockerapi.Escape(i.Name)+"?force=false&noprune=true", nil, nil)
	}
	return nil
}
func (d *Driver) prepareCache(ctx context.Context, keep string) error {
	c, err := cache.Read(cache.ConfigPath)
	if err != nil {
		return err
	}
	_, err = cache.Reclaim(ctx, imageCache{d, keep}, c, true)
	return err
}
func (d *Driver) Cache(ctx context.Context, prune bool) (cache.Report, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
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
