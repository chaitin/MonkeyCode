package vmdisk

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
)

// Ext4 uses the installer-provided mke2fs binary. It never mounts a guest disk.
type Ext4 struct {
	binary string
}

func NewExt4(binary string) (*Ext4, error) {
	if !filepath.IsAbs(binary) || filepath.Clean(binary) != binary {
		return nil, errors.New("mke2fs path must be absolute and clean")
	}
	return &Ext4{binary: binary}, nil
}

func (e *Ext4) Format(ctx context.Context, path string, size int64) error {
	return e.Populate(ctx, path, size, "")
}

func (e *Ext4) Populate(ctx context.Context, path string, size int64, root string) (err error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || size < 64<<20 || size%(4096) != 0 {
		return errors.New("invalid ext4 destination or capacity")
	}
	if root != "" {
		info, err := os.Lstat(root)
		if err != nil {
			return err
		}
		resolved, err := filepath.EvalSymlinks(root)
		if err != nil || !info.IsDir() || resolved != root {
			return errors.New("ext4 source must be an absolute directory without symlinks")
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := file.Close(); err == nil {
			err = closeErr
		}
		if err != nil {
			_ = os.Remove(path)
		}
	}()
	if err = file.Truncate(size); err != nil {
		return err
	}
	args := []string{"-q", "-t", "ext4", "-b", "4096", "-I", "256", "-m", "0", "-O", "^orphan_file,^metadata_csum_seed", "-E", "lazy_itable_init=0,lazy_journal_init=0,root_owner=0:0"}
	if root != "" {
		args = append(args, "-d", root)
	}
	args = append(args, "-F", path)
	cmd := exec.CommandContext(ctx, e.binary, args...)
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL=C"}
	// Formatter output is intentionally discarded: image-controlled filenames must
	// not turn a failed conversion into unbounded memory use or secret-bearing logs.
	if err = cmd.Run(); err != nil {
		return fmt.Errorf("format ext4: %w", err)
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	original, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || !os.SameFile(info, original) || info.Size() != size {
		return errors.New("formatter changed destination identity or capacity")
	}
	return syncExt4(file)
}

func syncExt4(file *os.File) error {
	var super [1024]byte
	if _, err := io.ReadFull(io.NewSectionReader(file, 1024, int64(len(super))), super[:]); err != nil {
		return fmt.Errorf("读取 ext4 超级块: %w", err)
	}
	if binary.LittleEndian.Uint16(super[56:58]) != 0xef53 || binary.LittleEndian.Uint32(super[24:28]) != 2 {
		return errors.New("格式化结果不是 4096 字节块的 ext4 文件系统")
	}
	blocks := uint64(binary.LittleEndian.Uint32(super[4:8]))
	incompat := binary.LittleEndian.Uint32(super[96:100])
	if incompat&0x40 == 0 {
		return errors.New("格式化结果未启用 ext4 extents")
	}
	if incompat&0x80 != 0 {
		blocks |= uint64(binary.LittleEndian.Uint32(super[336:340])) << 32
	}
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if blocks == 0 || blocks > uint64(info.Size())/4096 {
		return errors.New("ext4 文件系统容量超出磁盘文件边界")
	}
	return file.Sync()
}
