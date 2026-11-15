package runtimeupdate

import (
	"os"
	"os/exec"
	"testing"
)

func TestRuntimeUpdateWithPrivateUmask(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(t.Context(), "sh", "-c", `umask 077; exec "$@"`, "runtime-umask", executable, "-test.run=^TestRuntimeUpdateIsAtomicAndKeepsIdentity$", "-test.v")
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("严格umask下的程序目录访问、更新和回退失败: %v\n%s", err, output)
	}
}
