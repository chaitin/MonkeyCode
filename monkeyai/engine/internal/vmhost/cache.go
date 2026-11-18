package vmhost

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"syscall"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/cache"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmdisk"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmimage"
)

var templateKey = regexp.MustCompile(`^[a-f0-9]{64}$`)

type templateStore struct {
	root   string
	pinned map[string]bool
	data   string
}

func (d *Driver) Cache(ctx context.Context, prune bool) (cache.Report, error) {
	unlock, err := control.Lock(filepath.Join(d.state, "cache.lock"))
	if err != nil {
		return cache.Report{}, err
	}
	defer unlock()
	pinned, err := diskTemplateReferences(filepath.Join(d.data, "disks", "records"))
	if err != nil {
		return cache.Report{}, err
	}
	store := templateStore{root: filepath.Join(d.data, "templates", "templates"), data: d.data, pinned: pinned}
	config := cache.DefaultConfig()
	config.MinFreeBytes = d.config.Policy.RecoveryBytes
	config.MinFreeInodes = uint64(d.config.Policy.RecoveryInodes)
	if !prune {
		return cache.Inspect(ctx, store, config)
	}
	return cache.Reclaim(ctx, store, config, false)
}
func diskTemplateReferences(root string) (map[string]bool, error) {
	pinned := map[string]bool{}
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		existing, e := os.ReadDir(filepath.Join(filepath.Dir(root), "disks"))
		if e != nil && !errors.Is(e, os.ErrNotExist) {
			return nil, e
		}
		if len(existing) > 0 {
			return nil, errors.New("磁盘登记缺失且存在磁盘，拒绝回收模板")
		}
		return pinned, nil
	}
	if err != nil {
		return nil, err
	}
	physical := map[string]bool{}
	if len(entries) > 10000 {
		return nil, errors.New("磁盘登记数量超出可安全核对上限")
	}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".json" {
			return nil, errors.New("磁盘登记包含未知条目")
		}
		path := filepath.Join(root, entry.Name())
		info, err := os.Lstat(path)
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() > 64<<10 {
			return nil, errors.New("磁盘登记类型或权限无效")
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var disk vmdisk.Disk
		if json.Unmarshal(raw, &disk) != nil || !templateKey.MatchString(disk.Spec.TemplateID) || entry.Name() != storage.Key(disk.Spec.EnvironmentID)+".json" || disk.Spec.InstanceID == "" {
			return nil, errors.New("磁盘模板引用损坏，拒绝回收")
		}
		physical[storage.Key(disk.Spec.EnvironmentID)] = disk.State != "destroyed"
		if disk.State != "destroyed" {
			pinned[disk.Spec.TemplateID] = true
		}
	}
	present, err := os.ReadDir(filepath.Join(filepath.Dir(root), "disks"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	for _, entry := range present {
		if !templateKey.MatchString(entry.Name()) || !physical[entry.Name()] {
			return nil, errors.New("存在未登记或准备中的磁盘，暂不回收模板")
		}
	}
	return pinned, nil
}
func (s templateStore) Images(ctx context.Context) ([]cache.Image, error) {
	entries, err := os.ReadDir(s.root)
	if errors.Is(err, os.ErrNotExist) {
		return []cache.Image{}, nil
	}
	if err != nil {
		return nil, err
	}
	if len(entries) > 10000 {
		return nil, errors.New("模板缓存条目过多")
	}
	images := make([]cache.Image, 0, len(entries))
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !templateKey.MatchString(entry.Name()) {
			continue
		}
		path := filepath.Join(s.root, entry.Name())
		info, err := os.Lstat(path)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
			return nil, errors.New("模板缓存目录权限不安全")
		}
		metadata := filepath.Join(path, "manifest.json")
		info, err = os.Lstat(metadata)
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() > 8192 {
			return nil, errors.New("模板元数据不安全")
		}
		raw, err := os.ReadFile(metadata)
		if err != nil {
			return nil, err
		}
		var template vmimage.Template
		if json.Unmarshal(raw, &template) != nil {
			return nil, errors.New("模板元数据损坏")
		}
		key, err := template.Identity.Key()
		if err != nil || key != entry.Name() {
			return nil, errors.New("模板身份不一致")
		}
		disk, err := os.Lstat(filepath.Join(path, "root.ext4"))
		if err != nil {
			return nil, err
		}
		if !disk.Mode().IsRegular() || disk.Mode().Perm() != 0400 || disk.Size() != template.Identity.DiskBytes {
			return nil, errors.New("模板盘类型或容量无效")
		}
		images = append(images, cache.Image{Name: entry.Name(), Target: template.Identity.ImageDigest, Managed: true, Pinned: s.pinned[entry.Name()], UsedAt: info.ModTime()})
	}
	return images, nil
}
func (s templateStore) Usage(ctx context.Context) (cache.Usage, error) {
	capacity, err := vmdisk.ReadCapacity(s.data)
	if err != nil {
		return cache.Usage{}, err
	}
	var allocated int64
	err = filepath.WalkDir(s.root, func(path string, entry os.DirEntry, err error) error {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("模板缓存包含符号链接")
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Blocks < 0 || stat.Blocks > (1<<60-allocated)/512 {
			return errors.New("模板物理占用无法安全核对")
		}
		allocated += stat.Blocks * 512
		return nil
	})
	if err != nil {
		return cache.Usage{}, err
	}
	return cache.Usage{Bytes: allocated, FreeBytes: capacity.AvailableBytes, FreeInodes: uint64(capacity.FreeInodes)}, nil
}
func (s templateStore) Delete(ctx context.Context, want cache.Image) error {
	if !templateKey.MatchString(want.Name) || !want.Managed || want.Pinned || s.pinned[want.Name] {
		return errors.New("拒绝删除被引用或未知模板")
	}
	images, err := s.Images(ctx)
	if err != nil {
		return err
	}
	found := false
	for _, image := range images {
		if image.Name == want.Name && image.Target == want.Target && !image.Pinned {
			found = true
		}
	}
	if !found {
		return errors.New("模板在回收前发生变化")
	}
	path := filepath.Join(s.root, want.Name)
	if err := os.RemoveAll(path); err != nil {
		return err
	}
	directory, err := os.Open(s.root)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
