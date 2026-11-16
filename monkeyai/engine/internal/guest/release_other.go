//go:build !linux

package guest

import (
	"context"
	"errors"
)

func releaseRuntime(context.Context, string, string, string) (string, func(), error) {
	return "", nil, errors.New("runtime资源释放仅支持Linux虚拟机")
}
