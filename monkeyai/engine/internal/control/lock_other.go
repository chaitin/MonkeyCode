//go:build !linux && !darwin

package control

import (
	"context"
	"errors"
)

func WaitLock(_ context.Context, path string) (func(), error) { return Lock(path) }
func Lock(string) (func(), error)                             { return nil, errors.New("宿主服务仅支持 Linux") }
