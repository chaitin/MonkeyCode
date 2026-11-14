package enginehost

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBootstrapKeepsEnrollmentOutOfUnitArguments(t *testing.T) {
	cmd, dir := bootstrapCommand(t, false, "0")
	capture := filepath.Join(dir, "captured")
	fixture := []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$CAPTURE_ARGS\"\n")
	if err := os.WriteFile(filepath.Join(dir, "installer"), fixture, 0700); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(fixture)
	cmd.Args[6] = hex.EncodeToString(hash[:])
	injected := filepath.Join(dir, "injected")
	token := "fixture'$(touch " + injected + ")"
	cmd.Args[3] = token
	cmd.Env = append(cmd.Env, "CAPTURE_ARGS="+capture)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	args, err := os.ReadFile(capture)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(args), "--enrollment\n"+token+"\n") {
		t.Fatal("私有参数未按原值传递", string(args))
	}
	if _, err := os.Stat(injected); !os.IsNotExist(err) {
		t.Fatal("参数被作为shell执行", err)
	}
	unit, err := os.ReadFile(filepath.Join(dir, "args"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(unit), "enrollment") || strings.Contains(string(unit), "fixture") {
		t.Fatal("凭据进入systemd参数", string(unit))
	}
}
