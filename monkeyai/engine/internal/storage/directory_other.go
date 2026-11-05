//go:build !linux

package storage

import "os"

// 非 Linux 仅供本地目录测试；执行驱动仍要求 Linux。
func prepare(path string) error { return os.Chmod(path, 0700) }
