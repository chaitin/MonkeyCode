package driver

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockerapi"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

func sample() lifecycle.Spec {
	digest := "sha256:" + strings.Repeat("a", 64)
	return lifecycle.Spec{EnvironmentID: "env-a", InstanceID: "instance-a", Generation: 1, DesiredState: lifecycle.DesiredRunning, Driver: "gvisor", Image: "registry.example/image@" + digest, ImageDigest: digest, NetworkPolicy: "isolated", Resource: lifecycle.Resource{CPUMillis: 1500, MemoryBytes: 1 << 30, HostTasks: 512, TemporaryBytes: 128 << 20}, Volumes: []lifecycle.Volume{{ID: "project", Purpose: "workspace"}, {ID: "home", Purpose: "home"}, {ID: "runtime", Purpose: "runtime"}}}
}

type volumes []storage.Mount

func (v volumes) Ensure(context.Context, lifecycle.Spec) ([]storage.Mount, error) { return v, nil }
func mounts() volumes {
	return volumes{{Source: "/data/project", Target: "/workspace"}, {Source: "/data/home", Target: "/home/monkey"}, {Source: "/data/runtime", Target: "/var/lib/monkeyai"}}
}
func TestDockerConfigProtectsIdentityAndLimits(t *testing.T) {
	s := sample()
	s.Runtime = &lifecycle.Runtime{Server: "https://example.com", ServerID: "server", UserID: "user"}
	var i imageInfo
	i.Config.Env = []string{"HOME=/root", "LD_PRELOAD=/evil", "PATH=/evil"}
	i.Config.Entrypoint = []string{"/evil"}
	b := build(s, i, mounts(), "/data/resolv.conf")
	if b.User != "1000:1000" || b.Entrypoint[0] != "/usr/bin/tini" || !b.HostConfig.ReadonlyRootfs || b.HostConfig.Privileged || b.HostConfig.Runtime != dockerapi.Runtime {
		t.Fatal(b)
	}
	h := b.HostConfig
	if h.LogConfig.Type != "json-file" || h.LogConfig.Config["max-size"] != "10m" || h.LogConfig.Config["max-file"] != "1" {
		t.Fatal("日志必须可读取且限定 10 MiB", h.LogConfig)
	}
	if h.Memory != 1<<30 || h.MemorySwap != h.Memory || h.NanoCpus != 1500000000 || h.PidsLimit != 512 || h.Ulimits[1].Hard != 512 || h.RestartPolicy.Name != "no" {
		t.Fatal(h)
	}
	if !strings.Contains(strings.Join(b.Env, ";"), "LD_PRELOAD=;") {
		t.Fatal(b.Env)
	}
	s.NetworkPolicy = "public-only"
	if build(s, i, mounts(), "/data/resolv.conf").HostConfig.NetworkMode != instanceKey(s) {
		t.Fatal("未使用独立网络")
	}
}
func TestDockerOwnershipAndLifecycle(t *testing.T) {
	for _, policy := range []string{"isolated", "public-only"} {
		t.Run(policy, func(t *testing.T) { testDockerLifecycle(t, policy) })
	}
}
func testDockerLifecycle(t *testing.T, policy string) {
	dir, err := os.MkdirTemp("/tmp", "mae-api-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	dir, err = filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	socket := filepath.Join(dir, "docker.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	s := sample()
	s.NetworkPolicy = policy
	if policy == "public-only" {
		s.Runtime = &lifecycle.Runtime{Server: "https://example.com", ServerID: "server", UserID: "user"}
		if err := os.WriteFile(filepath.Join(dir, "nft"), []byte(`#!/bin/sh
if [ "$1" = -j ]; then echo '{"nftables":[]}'; else cat >/dev/null; fi
`), 0700); err != nil {
			t.Fatal(err)
		}
		t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	}
	var current *container
	network := true
	creates := 0
	var image imageInfo
	image.ID = "sha256:" + strings.Repeat("b", 64)
	image.Os = "linux"
	image.Architecture = runtime.GOARCH
	image.RepoDigests = []string{s.Image}
	image.Size = 1024
	image.Config.Cmd = []string{"sleep", "infinity"}
	image.Config.Labels = map[string]string{
		"org.opencontainers.image.title":       "MonkeyAI 云环境",
		"com.chaitin.monkeyai.runtime.version": "26.1030.1",
		ownerLabel:                             "image-owner",
		fingerprintLabel:                       "image-fingerprint",
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/v1.47")
		switch {
		case strings.HasPrefix(p, "/networks/"):
			if !network {
				w.WriteHeader(404)
				return
			}
			if r.Method == "DELETE" {
				network = false
				w.WriteHeader(204)
				return
			}
			attached := map[string]any{}
			if current != nil && current.State.Running {
				attached[current.ID] = map[string]string{"Name": strings.TrimPrefix(current.Name, "/")}
			}
			json.NewEncoder(w).Encode(map[string]any{
				"Id": strings.Repeat("c", 64), "Name": instanceKey(s), "Driver": "bridge",
				"Labels":  map[string]string{ownerLabel: "engine", fingerprintLabel: fingerprint(s), "io.monkeyai.dns": "1.1.1.1"},
				"Options": map[string]string{"com.docker.network.bridge.enable_icc": "false", "com.docker.network.bridge.enable_ip_masquerade": "true"},
				"IPAM":    map[string]any{"Config": []map[string]string{{"Subnet": "172.28.0.0/16"}}}, "Containers": attached,
			})
		case strings.HasSuffix(p, "/stats"):
			if p != "/containers/container-id/stats" || r.URL.Query().Get("stream") != "false" {
				t.Error("采集未绑定已验证实例或未关闭流式接口")
			}
			io.WriteString(w, `{"read":"2026-11-05T01:00:00Z","memory_stats":{"usage":1024,"stats":{"inactive_file":128}}}`)
		case strings.HasPrefix(p, "/images/"):
			json.NewEncoder(w).Encode(image)
		case p == "/containers/create":
			var b createBody
			if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
				t.Error(err)
			}
			if r.URL.Query().Get("name") != s.InstanceID {
				t.Error("容器未以实例 ID 命名")
			}
			creates++
			current = &container{ID: "container-id", Name: "/" + s.InstanceID, Image: image.ID, Config: b.Config, HostConfig: b.HostConfig}
			for key, value := range image.Config.Labels {
				if _, overridden := current.Config.Labels[key]; !overridden {
					current.Config.Labels[key] = value
				}
			}
			current.State.Status = "created"
			for _, m := range b.HostConfig.Mounts {
				current.Mounts = append(current.Mounts, struct {
					Type, Source, Destination string
					RW                        bool
				}{"bind", m.Source, m.Target, !m.ReadOnly})
			}
			if policy == "public-only" {
				current.NetworkSettings.Networks = map[string]struct{ NetworkID string }{instanceKey(s): {strings.Repeat("c", 64)}}
			}
			w.WriteHeader(201)
			io.WriteString(w, `{"Id":"container-id"}`)
		case strings.HasSuffix(p, "/json"):
			if current == nil || p != "/containers/"+strings.TrimPrefix(current.Name, "/")+"/json" {
				w.WriteHeader(404)
				io.WriteString(w, `{"message":"not found"}`)
			} else {
				json.NewEncoder(w).Encode(current)
			}
		case strings.HasSuffix(p, "/start"):
			current.State.Running = true
			current.State.Status = "running"
			w.WriteHeader(204)
		case strings.HasSuffix(p, "/stop"):
			current.State.Running = false
			current.State.Status = "exited"
			w.WriteHeader(204)
		case r.Method == "DELETE":
			current = nil
			w.WriteHeader(204)
		default:
			t.Errorf("未知调用 %s %s", r.Method, p)
			w.WriteHeader(500)
		}
	})
	server := &http.Server{Handler: handler}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close() })
	d := &Driver{client: dockerapi.New(socket), root: filepath.Join(dir, "instances"), volumes: mounts()}
	t.Cleanup(func() { d.Close() })
	ctx := t.Context()
	ref, err := d.Create(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	current.State.Running = true
	u, err := d.Usage(ctx, s, ref)
	if err != nil || u == nil || u.MemoryBytes == nil || *u.MemoryBytes != 896 {
		t.Fatal("Docker 采集失败", u, err)
	}
	current.State.Running = false
	if _, err = d.Create(ctx, s); err != nil || creates != 1 {
		t.Fatal(creates, err)
	}
	if !owned(current.Config.Labels, s) || current.Config.Labels["org.opencontainers.image.title"] != "MonkeyAI 云环境" {
		t.Fatal("镜像标签覆盖了归属标签或未被继承")
	}
	current.Config.Labels[ownerLabel] = "other"
	if _, err = d.Inspect(ctx, s, ref); err == nil {
		t.Fatal("接受被篡改的归属标签")
	}
	current.Config.Labels[ownerLabel] = "engine"
	current.Config.Labels["unexpected"] = "label"
	if _, err = d.Inspect(ctx, s, ref); err == nil {
		t.Fatal("接受不属于镜像或 engine 的额外标签")
	}
	delete(current.Config.Labels, "unexpected")
	originalLog := current.HostConfig.LogConfig
	current.HostConfig.LogConfig.Config = map[string]string{"max-size": "20m", "max-file": "1"}
	if _, err = d.Inspect(ctx, s, ref); err == nil {
		t.Fatal("接受超过上限的日志配置")
	}
	current.HostConfig.LogConfig.Type = "none"
	current.HostConfig.LogConfig.Config = nil
	if _, err = d.Inspect(ctx, s, ref); err == nil {
		t.Fatal("新容器关闭日志未被发现")
	}
	current.Name = "/" + instanceKey(s)
	if _, err = d.Inspect(ctx, s, instanceKey(s)); err != nil {
		t.Fatal("旧容器无法继续管理", err)
	}
	current.Name = "/" + s.InstanceID
	current.HostConfig.LogConfig = originalLog
	current.HostConfig.Privileged = true
	if err = d.Start(ctx, s, ref); err == nil {
		t.Fatal("接受特权容器")
	}
	current.HostConfig.Privileged = false
	if err = d.Start(ctx, s, ref); err != nil {
		t.Fatal(err)
	}
	actual, err := d.Inspect(ctx, s, ref)
	if err != nil || actual.Phase != lifecycle.InstanceRunning {
		t.Fatal(actual, err)
	}
	if s.Runtime != nil {
		if _, err = d.runtimeContainer(ctx, s); err != nil {
			t.Fatal("runtime 网络校验失败", err)
		}
	}
	if err = d.Remove(ctx, s, ref); err == nil {
		t.Fatal("删除了运行实例")
	}
	if err = d.Stop(ctx, s, ref); err != nil {
		t.Fatal(err)
	}
	if err = d.Start(ctx, s, ref); err == nil {
		t.Fatal("重新执行了已退出实例")
	}
	if err = d.Remove(ctx, s, ref); err != nil {
		t.Fatal(err)
	}
	if err = d.Remove(ctx, s, ref); err != nil {
		t.Fatal(err)
	}
	if _, err = d.Create(ctx, s); err == nil {
		t.Fatal("复用了已回收实例")
	}
}
func TestExecFramesAndBounds(t *testing.T) {
	frame := func(channel byte, s string) []byte {
		header := make([]byte, 8)
		header[0] = channel
		binary.BigEndian.PutUint32(header[4:], uint32(len(s)))
		return append(header, []byte(s)...)
	}
	data := append(frame(1, "{}\n"), frame(2, "stderr")...)
	var out bytes.Buffer
	if err := demux(bytes.NewReader(data), &out); err != nil || out.String() != "{}\n" {
		t.Fatal(out.String(), err)
	}
	for _, bad := range [][]byte{data[:7], frame(3, "bad"), frame(1, strings.Repeat("x", 65537))} {
		if err := demux(bytes.NewReader(bad), io.Discard); err == nil {
			t.Fatal("接受无效 Docker 输出")
		}
	}
}
