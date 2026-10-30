//go:build !linux

package storage

import (
	"context"
	"errors"
)

type XFS struct{}

func (XFS) Available(context.Context, string, uint32) (bool, error) {
	return false, errors.New("XFS 配额需要 Linux")
}
func (XFS) Reserve(context.Context, string, int64, int64) error {
	return errors.New("XFS 配额需要 Linux")
}

func (XFS) Check(context.Context, string) error          { return errors.New("XFS 配额需要 Linux") }
func (XFS) Assign(context.Context, string, uint32) error { return errors.New("XFS 配额需要 Linux") }
func (XFS) Limit(context.Context, string, uint32, int64, int64) error {
	return errors.New("XFS 配额需要 Linux")
}
