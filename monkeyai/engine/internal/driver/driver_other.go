//go:build !linux

package driver

import (
	"context"
	"errors"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/cache"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

type Volumes interface {
	Ensure(context.Context, lifecycle.Spec) ([]storage.Mount, error)
}
type Driver struct{}

var errLinux = errors.New("containerd/gVisor 驱动需要 Linux")

func New(string, string, Volumes) (*Driver, error)                     { return nil, errLinux }
func (*Driver) Close() error                                           { return nil }
func (*Driver) Prepare(context.Context, lifecycle.Spec) error          { return errLinux }
func (*Driver) Create(context.Context, lifecycle.Spec) (string, error) { return "", errLinux }
func (*Driver) Start(context.Context, lifecycle.Spec, string) error    { return errLinux }
func (*Driver) Stop(context.Context, lifecycle.Spec, string) error     { return errLinux }
func (*Driver) Inspect(context.Context, lifecycle.Spec, string) (lifecycle.Instance, error) {
	return lifecycle.Instance{}, errLinux
}
func (*Driver) Remove(context.Context, lifecycle.Spec, string) error { return errLinux }

func (*Driver) Cache(context.Context, bool) (cache.Report, error) { return cache.Report{}, errLinux }

func (*Driver) Status(context.Context, lifecycle.Spec) (standalone.Status, error) {
	return standalone.Status{}, errLinux
}
func (*Driver) Login(context.Context, lifecycle.Spec, func(string) error) error { return errLinux }
func (*Driver) Serve(context.Context, lifecycle.Spec, bool) error               { return errLinux }
