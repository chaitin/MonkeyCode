//go:build !linux

package main

import "errors"

func mountFilesystems() error { return errors.New("最小虚拟机自检仅支持Linux") }
