//go:build !linux && !darwin

package control

import "errors"

func Lock(string) (func(), error) { return nil, errors.New("宿主服务仅支持 Linux") }
