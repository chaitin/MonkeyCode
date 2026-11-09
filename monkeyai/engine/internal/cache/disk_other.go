//go:build !linux

package cache

import (
	"context"
	"errors"
	"os"
)

func owned(os.FileInfo) error { return nil }
func Disk(context.Context, string) (Usage, error) {
	return Usage{}, errors.New("缓存磁盘检查需要 Linux")
}

func Space(string) (Usage, error) { return Usage{}, errors.New("Docker 磁盘检查需要 Linux") }
