//go:build !linux

package vmimage

import (
	"context"
	"errors"
	"io"
)

func ConvertAs(context.Context, uint32, io.Writer) error {
	return errors.New("隔离镜像转换只支持Linux")
}
