package driver

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
)

func TestServeRecordRetainsOriginalInvocation(t *testing.T) {
	var old serveRecord
	if err := json.Unmarshal([]byte(`{"ID":"exec","Fingerprint":"spec"}`), &old); err != nil {
		t.Fatal(err)
	}
	files := standalone.Files{Binary: "/tmp/path with spaces", Engine: "/runtime/engine"}
	normal := serveCommand(files, old.ContainerLogs)
	if normal[0] != files.Binary {
		t.Fatal("旧记录必须检查原二进制")
	}
	wrapped := serveCommand(files, true)
	if !slices.Equal(wrapped[4:], normal) {
		t.Fatal("重定向不能改变 runtime 的参数")
	}
}
func TestContainerStdStreams(t *testing.T) {
	image := os.Getenv("MONKEYAI_TEST_LOG_IMAGE")
	if image == "" {
		t.Skip("未提供本地环境镜像")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	run := func(args ...string) string {
		t.Helper()
		out, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
		if err != nil {
			t.Fatalf("Docker 验证失败: %v: %s", err, out)
		}
		return strings.TrimSpace(string(out))
	}
	id := run("run", "--pull=never", "-d", "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "1000:1000", "--entrypoint", "/usr/bin/tini", image, "-g", "--", "/bin/sleep", "infinity")
	defer func() {
		if out, err := exec.Command("docker", "rm", "-f", id).CombinedOutput(); err != nil {
			t.Error(err, string(out))
		}
	}()
	files := standalone.Files{Binary: "/tmp/test runtime", Engine: "/tmp/engine"}
	run("exec", id, "/bin/sh", "-ec", `printf '%s
' '#!/bin/sh' 'echo serve-out' 'echo serve-err >&2' > '/tmp/test runtime'; chmod 700 '/tmp/test runtime'`)
	if out := run(append([]string{"exec", id}, serveCommand(files, false)...)...); !strings.Contains(out, "serve-out") {
		t.Fatal(out)
	}
	if out := run("logs", id); out != "" {
		t.Fatal("未启用时输出进入容器日志", out)
	}
	if out := run(append([]string{"exec", id}, serveCommand(files, true)...)...); out != "" {
		t.Fatal("输出没有重定向", out)
	}
	cmd := exec.CommandContext(ctx, "docker", "logs", id)
	out, err := cmd.Output()
	if err != nil || strings.TrimSpace(string(out)) != "serve-out" {
		t.Fatal(err, string(out))
	}
	both := run("logs", id)
	if !strings.Contains(both, "serve-err") {
		t.Fatal("缺少 stderr", both)
	}
}
