package vmdisk

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
)

// Copy creates a new sparse disk; it never replaces an existing destination.
func Copy(ctx context.Context, source, destination string) (err error) {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("磁盘模板必须是普通文件")
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	actual, err := in.Stat()
	if err != nil {
		return err
	}
	if !os.SameFile(info, actual) {
		return errors.New("磁盘模板在打开时发生变化")
	}
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := out.Close(); err == nil {
			err = closeErr
		}
		if err != nil {
			_ = os.Remove(destination)
		}
	}()
	if err = ctx.Err(); err != nil {
		return err
	}
	cloned, err := reflink(out, in)
	if err != nil {
		return err
	}
	if !cloned {
		if err = sparseCopy(ctx, out, in, actual.Size()); err != nil {
			return err
		}
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	return out.Sync()
}

func sparseCopy(ctx context.Context, out *os.File, in io.Reader, size int64) error {
	buffer := make([]byte, 1024*1024)
	zero := make([]byte, len(buffer))
	var offset int64
	for offset < size {
		if err := ctx.Err(); err != nil {
			return err
		}
		length := min(int64(len(buffer)), size-offset)
		n, err := io.ReadFull(in, buffer[:length])
		if err != nil {
			return fmt.Errorf("读取磁盘模板: %w", err)
		}
		if !bytes.Equal(buffer[:n], zero[:n]) {
			if _, err := out.WriteAt(buffer[:n], offset); err != nil {
				return err
			}
		}
		offset += int64(n)
	}
	return out.Truncate(size)
}
