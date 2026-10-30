package cache

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/unix"
)

func owned(info os.FileInfo) error {
	s, ok := info.Sys().(*syscall.Stat_t)
	if !ok || s.Uid != 0 {
		return errors.New("缓存配置必须由 root 所有")
	}
	return nil
}
func Disk(ctx context.Context, root string) (Usage, error) {
	var u Usage
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		return u, err
	}
	if resolved != root || root == "/" {
		return u, errors.New("缓存路径必须是独立规范目录")
	}
	var stat unix.Statfs_t
	if err := unix.Statfs(root, &stat); err != nil {
		return u, err
	}
	if stat.Bsize <= 0 || stat.Bsize > 4096 || stat.Bavail > uint64((1<<63-1)/stat.Bsize) {
		return u, errors.New("磁盘容量无效")
	}
	u.FreeBytes = int64(stat.Bavail) * stat.Bsize
	u.FreeInodes = stat.Ffree
	info, err := os.Stat(root)
	if err != nil {
		return u, err
	}
	base, ok := info.Sys().(*syscall.Stat_t)
	if !ok || !info.IsDir() {
		return u, errors.New("缓存目录类型无效")
	}
	count := 0
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		count++
		if count > 10000000 {
			return errors.New("缓存目录项过多，需管理员核对")
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		s, ok := info.Sys().(*syscall.Stat_t)
		if !ok || s.Dev != base.Dev {
			return errors.New("缓存目录包含其他挂载")
		}
		if s.Blocks < 0 || s.Blocks > (1<<63-1-u.Bytes)/512 {
			return errors.New("缓存占用无效")
		}
		u.Bytes += s.Blocks * 512
		return nil
	})
	return u, err
}
