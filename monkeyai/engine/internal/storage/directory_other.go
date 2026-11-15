//go:build !linux

package storage

import "os"

// 非 Linux 仅供本地目录测试；执行驱动仍要求 Linux。
func prepareRuntime(path string) error { return os.Chmod(path, 0755) }

func prepareRuntimeLock(path string) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err == nil {
		file.Close()
	} else if !os.IsExist(err) {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() != 0 {
		return os.ErrInvalid
	}
	return os.Chmod(path, 0600)
}

func prepare(path string) error { return os.Chmod(path, 0700) }
