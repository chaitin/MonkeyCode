//go:build linux

package main

import (
	"golang.org/x/sys/unix"
	"os"
)

func mountFilesystems() error {
	for _, fs := range []struct{ name, kind string }{{"/dev", "devtmpfs"}, {"/proc", "proc"}, {"/sys", "sysfs"}} {
		if err := os.MkdirAll(fs.name, 0755); err != nil {
			return err
		}
		if err := unix.Mount(fs.kind, fs.name, fs.kind, unix.MS_NOSUID|unix.MS_NOEXEC, ""); err != nil {
			return err
		}
	}
	return nil
}
