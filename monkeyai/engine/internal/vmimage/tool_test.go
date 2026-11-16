package vmimage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestToolIntegrity(t *testing.T) {
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "converter")
	data := []byte("#!/bin/sh\nexit 0\n")
	if err := os.WriteFile(path, data, 0700); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	tool := Tool{Path: path, Digest: "sha256:" + hex.EncodeToString(sum[:])}
	if err := tool.Verify(context.Background()); err != nil {
		t.Fatal(err)
	}
	bad := tool
	bad.Digest = "sha256:" + strings.Repeat("0", 64)
	if err := bad.Verify(context.Background()); err == nil {
		t.Fatal("摘要不匹配必须失败")
	}
	if err := os.Chmod(path, 0770); err != nil {
		t.Fatal(err)
	}
	if err := tool.Verify(context.Background()); err == nil {
		t.Fatal("其他用户可写的工具必须拒绝")
	}
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	if err := tool.Verify(context.Background()); err == nil {
		t.Fatal("不可执行工具必须拒绝")
	}
	if err := os.Chmod(path, 0700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	linked := tool
	linked.Path = link
	if err := linked.Verify(context.Background()); err == nil {
		t.Fatal("符号链接工具必须拒绝")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := tool.Verify(ctx); err == nil {
		t.Fatal("取消后不能通过工具校验")
	}
}
