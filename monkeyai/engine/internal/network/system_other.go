//go:build !linux

package network

import (
	"context"
	"errors"
	"os"
)

type local struct{}

var errLinux = errors.New("宿主网络管理需要 Linux root")

func ownedFile(os.FileInfo) error                                 { return nil }
func (local) Create(context.Context, binding) (uint64, error)     { return 0, errLinux }
func (local) Attach(context.Context, binding) (Connection, error) { return Connection{}, errLinux }
func (local) Guard(context.Context, binding) error                { return errLinux }
func (local) Detach(context.Context, binding) error               { return errLinux }
func (local) Delete(context.Context, binding) error               { return errLinux }
func Policies(context.Context) []string                           { return []string{"isolated"} }
