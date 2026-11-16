//go:build linux || darwin

package vmdisk

import (
	"fmt"
	"math"

	"golang.org/x/sys/unix"
)

func ReadCapacity(path string) (Capacity, error) {
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return Capacity{}, fmt.Errorf("读取磁盘容量: %w", err)
	}
	blockSize := int64(stat.Bsize)
	if blockSize <= 0 || uint64(stat.Blocks) > uint64(math.MaxInt64/blockSize) || uint64(stat.Bavail) > uint64(math.MaxInt64/blockSize) || uint64(stat.Files) > math.MaxInt64 || uint64(stat.Ffree) > math.MaxInt64 {
		return Capacity{}, fmt.Errorf("文件系统容量超出支持范围")
	}
	return Capacity{
		TotalBytes:     int64(stat.Blocks) * blockSize,
		AvailableBytes: int64(stat.Bavail) * blockSize,
		TotalInodes:    int64(stat.Files),
		FreeInodes:     int64(stat.Ffree),
	}, nil
}
