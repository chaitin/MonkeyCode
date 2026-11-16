//go:build !linux

package vmdisk

import "os"

func reflink(out, in *os.File) (bool, error) {
	return false, nil
}
