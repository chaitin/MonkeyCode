package relay

import (
	"archive/tar"
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// docker cp 默认把文件交给 root；测试证书与配置应仅供容器中的 nginx 用户读取。
func copyNginxFixture(t *testing.T, ctx context.Context, id, source, dest string) {
	t.Helper()
	data, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	if err = tw.WriteHeader(&tar.Header{Name: filepath.Base(dest), Mode: 0600, Uid: 101, Gid: 101, Size: int64(len(data))}); err != nil {
		t.Fatal(err)
	}
	if _, err = tw.Write(data); err != nil {
		t.Fatal(err)
	}
	if err = tw.Close(); err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(ctx, "docker", "cp", "-a", "-", id+":"+filepath.Dir(dest))
	cmd.Stdin = &buf
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("复制 NGINX 测试配置：%s: %v", output, err)
	}
}
