package vmimage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
)

// Tool 指向安装器交付并固定摘要的转换工具，不从 PATH 查找可执行文件。
type Tool struct {
	Path   string `json:"path"`
	Digest string `json:"digest"`
}

func (t Tool) Verify(ctx context.Context) error {
	if !filepath.IsAbs(t.Path) || filepath.Clean(t.Path) != t.Path || !digestPattern.MatchString(t.Digest) {
		return fmt.Errorf("转换工具路径或摘要无效")
	}
	info, err := os.Lstat(t.Path)
	if err != nil {
		return fmt.Errorf("读取转换工具: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 || info.Mode().Perm()&0022 != 0 || info.Size() <= 0 || info.Size() > 512<<20 {
		return fmt.Errorf("转换工具必须是不可被组或其他用户修改的普通可执行文件")
	}
	file, err := os.Open(t.Path)
	if err != nil {
		return err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return fmt.Errorf("转换工具在校验前发生变化")
	}
	h := sha256.New()
	buffer := make([]byte, 128<<10)
	var n int64
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		count, readErr := file.Read(buffer)
		if count > 0 {
			n += int64(count)
			if n > info.Size() {
				return fmt.Errorf("转换工具在校验时发生变化")
			}
			_, _ = h.Write(buffer[:count])
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if n != info.Size() || "sha256:"+hex.EncodeToString(h.Sum(nil)) != t.Digest {
		return fmt.Errorf("转换工具摘要不匹配")
	}
	return nil
}

func (t Tool) Run(ctx context.Context, args ...string) error {
	if err := t.Verify(ctx); err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, t.Path, args...)
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL=C", "HOME=/nonexistent"}
	// 镜像凭据和层内容不可经命令输出进入 Runner 日志。
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("转换工具 %s 执行失败: %w", filepath.Base(t.Path), err)
	}
	return nil
}
