package control

import (
	"crypto/ed25519"
	"crypto/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func remoteTask() UpgradeTask {
	return UpgradeTask{ID: "11111111-1111-4111-8111-111111111111", Version: "v26110406", InstallerSHA: Digest([]byte("installer")), ManifestSHA: Digest([]byte("manifest"))}
}
func fakeSystemd(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for name, script := range map[string]string{
		"systemd-run": "#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$ENGINE_TEST_ARGS\"\nexit \"${ENGINE_TEST_EXIT:-0}\"\n",
		"systemctl":   "#!/bin/sh\nprintf '%s\\n' \"${ENGINE_TEST_STATE:-active}\"\nexit \"${ENGINE_TEST_CHECK_EXIT:-0}\"\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	path := filepath.Join(dir, "args")
	t.Setenv("ENGINE_TEST_ARGS", path)
	return path
}
func TestRemoteUpgradeLaunchAndRecovery(t *testing.T) {
	args := fakeSystemd(t)
	f := remoteFile(filepath.Join(t.TempDir(), "remote.json"))
	task := remoteTask()
	if err := f.launch(t.Context(), task); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(args)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"--unit=monkeyai-engine-upgrade-" + task.ID, "--collect", "--property=RuntimeMaxSec=26min", "remote-upgrade\n" + task.ID} {
		if !strings.Contains(string(before), want) {
			t.Fatal("缺少独立服务参数", want)
		}
	}
	if strings.Contains(string(before), "--scope") || strings.Contains(string(before), "--wait") {
		t.Fatal("升级进程不能依附 engine 服务")
	}
	if err := f.launch(t.Context(), task); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(args)
	if string(after) != string(before) {
		t.Fatal("重复心跳重复启动升级")
	}
	changed := task
	changed.ManifestSHA = Digest([]byte("changed"))
	if err := f.launch(t.Context(), changed); err == nil {
		t.Fatal("接受同一任务修改发行摘要")
	}
	next := task
	next.ID = "22222222-2222-4222-8222-222222222222"
	if err := f.launch(t.Context(), next); err == nil {
		t.Fatal("并发启动两个升级")
	}
	report, err := f.report(t.Context())
	if err != nil || report.Status != "running" {
		t.Fatal(report, err)
	}
	t.Setenv("ENGINE_TEST_CHECK_EXIT", "1")
	report, err = f.report(t.Context())
	if err == nil || report.Status != "running" {
		t.Fatal("systemd 查询失败不应误判升级失败", report, err)
	}
	t.Setenv("ENGINE_TEST_CHECK_EXIT", "0")
	t.Setenv("ENGINE_TEST_STATE", "inactive")
	report, err = f.report(t.Context())
	if err != nil || report.Status != "failed" || report.Reason != "upgrade_interrupted" {
		t.Fatal(report, err)
	}
	if err := f.launch(t.Context(), next); err != nil {
		t.Fatal("中断后不能重试", err)
	}
	state, err := f.read()
	if err != nil {
		t.Fatal(err)
	}
	state.Result.Status = "succeeded"
	if err := f.save(state); err != nil {
		t.Fatal(err)
	}
	report, err = f.report(t.Context())
	if err != nil || report.Status != "succeeded" {
		t.Fatal("已完成任务不能误报中断", report, err)
	}
	info, err := os.Stat(string(f))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal(info, err)
	}
}
func TestRemoteUpgradeLaunchFailureAndValidation(t *testing.T) {
	fakeSystemd(t)
	t.Setenv("ENGINE_TEST_EXIT", "1")
	f := remoteFile(filepath.Join(t.TempDir(), "remote.json"))
	if err := f.launch(t.Context(), remoteTask()); err == nil {
		t.Fatal("启动失败未返回错误")
	}
	report, err := f.report(t.Context())
	if err != nil || report.Status != "failed" || report.Reason != "launch_failed" {
		t.Fatal(report, err)
	}
	for _, change := range []func(*UpgradeTask){
		func(v *UpgradeTask) { v.ID = "--bad" }, func(v *UpgradeTask) { v.Version = "../x" },
		func(v *UpgradeTask) { v.Version = "latest" }, func(v *UpgradeTask) { v.ManifestSHA = "bad" },
		func(v *UpgradeTask) { v.InstallerSHA = "bad" },
	} {
		v := remoteTask()
		change(&v)
		if err := f.launch(t.Context(), v); err == nil {
			t.Fatal("接受无效任务", v)
		}
	}
	if err := os.WriteFile(string(f), []byte("bad"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := f.launch(t.Context(), remoteTask()); err == nil {
		t.Fatal("覆盖损坏状态")
	}
}
func TestDownloadInstaller(t *testing.T) {
	for _, mode := range []string{"ok", "checksum", "redirect", "missing", "truncated", "tls"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/host/v1/releases/v26110406/amd64/installer" {
					t.Error("错误下载路径", r.URL.Path)
				}
				switch mode {
				case "redirect":
					http.Redirect(w, r, "/elsewhere", 302)
					return
				case "missing":
					http.NotFound(w, r)
					return
				case "truncated":
					w.Header().Set("Content-Length", "100")
				}
				_, _ = w.Write([]byte("installer"))
			}))
			defer server.Close()
			_, key, _ := ed25519.GenerateKey(rand.Reader)
			client, err := New(server.URL, key)
			if err != nil {
				t.Fatal(err)
			}
			client.WithInsecure(mode != "tls")
			task := remoteTask()
			if mode == "checksum" {
				task.InstallerSHA = Digest([]byte("bad"))
			}
			dir := t.TempDir()
			path := filepath.Join(dir, "installer")
			err = downloadInstaller(t.Context(), client, task, "amd64", path)
			if mode == "ok" {
				if err != nil {
					t.Fatal(err)
				}
				raw, _ := os.ReadFile(path)
				info, _ := os.Stat(path)
				if string(raw) != "installer" || info.Mode().Perm() != 0700 {
					t.Fatal("安装器内容或权限错误")
				}
			} else {
				if err == nil {
					t.Fatal("应拒绝失败或未校验的下载")
				}
				entries, _ := os.ReadDir(dir)
				if len(entries) != 0 {
					t.Fatal("留下不完整安装器", entries)
				}
			}
		})
	}
}
