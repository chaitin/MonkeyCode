//go:build linux

package vmdisk

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

func reflink(out, in *os.File) (bool, error) {
	err := unix.IoctlFileClone(int(out.Fd()), int(in.Fd()))
	if err == nil {
		return true, nil
	}
	if errors.Is(err, unix.EXDEV) || errors.Is(err, unix.EOPNOTSUPP) || errors.Is(err, unix.ENOTTY) || errors.Is(err, unix.EINVAL) {
		return false, out.Truncate(0)
	}
	return false, err
}
