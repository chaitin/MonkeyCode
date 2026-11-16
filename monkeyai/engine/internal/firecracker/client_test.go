package firecracker

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func sampleConfig() Config {
	rate := Rate{Bandwidth: Bucket{Size: 1048576, RefillMS: 100}, Operations: Bucket{Size: 100, RefillMS: 100}}
	return Config{ID: "env-1", Machine: Machine{VCPUCount: 2, MemoryMiB: 512}, Boot: Boot{Kernel: "/kernel", Args: "console=ttyS0 root=/dev/vda rw"}, System: Drive{ID: "system", Path: "/system.ext4", Root: true, Cache: "Writeback", IOEngine: "Sync", Rate: rate}, Data: Drive{ID: "data", Path: "/data.ext4", Cache: "Writeback", IOEngine: "Sync", Rate: rate}, Vsock: Vsock{ID: "management", CID: 3, Path: "/run/guest.sock"}}
}
func apiFixture(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	// Unix socket path on macOS must remain below its small sockaddr_un bound.
	dir, err := os.MkdirTemp("/tmp", "fc-api-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	socket := filepath.Join(dir, "api.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: handler}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close() })
	client, err := NewClient(socket)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	return client
}
func TestConfigureAndLifecycle(t *testing.T) {
	state := "Not started"
	var paths []string
	c := apiFixture(t, func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		if r.URL.Path == "/" {
			json.NewEncoder(w).Encode(Info{ID: "env-1", State: state})
			return
		}
		if r.URL.Path == "/actions" {
			state = "Running"
		}
		if r.Method == "PATCH" {
			var in map[string]string
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Error(err)
			}
			if in["state"] == "Paused" {
				state = "Paused"
			} else {
				state = "Running"
			}
		}
		if strings.HasPrefix(r.URL.Path, "/drives/") {
			var d Drive
			if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
				t.Error(err)
			}
			if d.Cache != "Writeback" {
				t.Error("flush未启用")
			}
		}
		w.WriteHeader(204)
	})
	ctx := context.Background()
	config := sampleConfig()
	if err := c.Configure(ctx, config); err != nil {
		t.Fatal(err)
	}
	expected := []string{"GET /", "PUT /machine-config", "PUT /boot-source", "PUT /drives/system", "PUT /drives/data", "PUT /vsock"}
	if fmt.Sprint(paths) != fmt.Sprint(expected) {
		t.Fatalf("配置顺序错误: %v", paths)
	}
	if err := c.Start(ctx, config.ID); err != nil {
		t.Fatal(err)
	}
	if err := c.Start(ctx, config.ID); err == nil {
		t.Fatal("重复启动")
	}
	if err := c.Configure(ctx, config); err == nil {
		t.Fatal("运行中重新配置")
	}
	if err := c.Pause(ctx, config.ID); err != nil || state != "Paused" {
		t.Fatal(err, state)
	}
	if err := c.Pause(ctx, config.ID); err != nil {
		t.Fatal(err)
	}
	if err := c.Resume(ctx, "different"); err == nil {
		t.Fatal("跨实例恢复")
	}
	if err := c.Resume(ctx, config.ID); err != nil || state != "Running" {
		t.Fatal(err, state)
	}
}
func TestAPIFailClosed(t *testing.T) {
	for _, mode := range []string{"unknown", "multiple", "oversize", "redirect", "status", "wrong-id"} {
		t.Run(mode, func(t *testing.T) {
			c := apiFixture(t, func(w http.ResponseWriter, r *http.Request) {
				switch mode {
				case "unknown":
					fmt.Fprint(w, `{"id":"env-1","state":"unknown"}`)
				case "multiple":
					fmt.Fprint(w, `{"id":"env-1","state":"Running"} {}`)
				case "oversize":
					fmt.Fprint(w, strings.Repeat("x", maxResponse+1))
				case "redirect":
					http.Redirect(w, r, "http://example.com/", 302)
				case "status":
					w.WriteHeader(400)
				case "wrong-id":
					json.NewEncoder(w).Encode(Info{ID: "other", State: "Not started"})
				}
			})
			if err := c.Configure(t.Context(), sampleConfig()); err == nil {
				t.Fatal("无效API状态被接受")
			}
		})
	}
}
func TestConfigValidation(t *testing.T) {
	for _, change := range []func(*Config){
		func(c *Config) { c.ID = "../../evil" }, func(c *Config) { c.Machine.SMT = true }, func(c *Config) { c.Data.Path = c.System.Path }, func(c *Config) { c.System.Cache = "Unsafe" }, func(c *Config) { c.System.IOEngine = "Async" }, func(c *Config) { c.Data.ReadOnly = true }, func(c *Config) { c.Data.Rate.Bandwidth.Size = 0 }, func(c *Config) { c.Vsock.CID = 2 }, func(c *Config) { c.Boot.Kernel = "relative" }, func(c *Config) { c.Boot.Args = "bad\nargument" },
	} {
		config := sampleConfig()
		change(&config)
		if err := config.Validate(); err == nil {
			t.Fatalf("接受非法配置: %+v", config)
		}
	}
}
