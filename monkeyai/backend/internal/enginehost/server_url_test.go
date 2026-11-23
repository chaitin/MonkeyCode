package enginehost

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestServerURLScriptAndBootstrap(t *testing.T) {
	for _, address := range []string{"", "http://work.chaitin.net", "http://127.0.0.1:8080/"} {
		t.Run(address, func(t *testing.T) {
			cmd, dir := bootstrapCommand(t, false, "0")
			argsPath := filepath.Join(dir, "installer-args")
			source := filepath.Join(dir, "installer")
			program := []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$INSTALL_ARGS\"\n")
			if err := os.WriteFile(source, program, 0700); err != nil {
				t.Fatal(err)
			}
			releases := fixture(t)
			for _, arch := range []string{"amd64", "arm64"} {
				path := filepath.Join(releases, "v1", arch, "manifest.json")
				raw, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				var m manifest
				if err := json.Unmarshal(raw, &m); err != nil {
					t.Fatal(err)
				}
				m.Files["installer"] = hash(program)
				raw, _ = json.Marshal(m)
				if err := os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
			}
			service := NewService(nil).WithInstallation("https://control.example", releases, "v1").WithLicense(installationLicense(true))
			router := chi.NewRouter()
			service.Register(router)
			query := url.Values{"version": {"v1"}}
			if address != "" {
				query.Set("server_url", address)
			}
			response := call(router, "GET", "/api/host/v1/install.sh?"+query.Encode(), nil)
			if response.Code != 200 {
				t.Fatal(response.Code, response.Body.String())
			}
			body := strings.Replace(response.Body.String(), "[ -d /run/systemd/system ] || fail '宿主需要运行 systemd'", "true", 1)
			if err := os.WriteFile(cmd.Args[1], []byte(body), 0700); err != nil {
				t.Fatal(err)
			}
			cmd.Args = cmd.Args[:2]
			cmd.Env = append(cmd.Env, "INSTALL_ARGS="+argsPath)
			curlPath := filepath.Join(dir, "bin", "curl")
			mock, err := os.ReadFile(curlPath)
			if err != nil {
				t.Fatal(err)
			}
			mock = append([]byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$CURL_ARGS\"\n"), mock...)
			if err := os.WriteFile(curlPath, mock, 0700); err != nil {
				t.Fatal(err)
			}
			curlArgs := filepath.Join(dir, "curl-args")
			cmd.Env = append(cmd.Env, "CURL_ARGS="+curlArgs)
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("安装脚本失败：%v %s", err, output)
			}
			args, err := os.ReadFile(argsPath)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(args), "--server\nhttps://control.example\n") {
				t.Fatal("后台签名标识被覆盖", string(args))
			}
			if address == "" {
				if strings.Contains(string(args), "--server-url") {
					t.Fatal("默认命令不应传递 server-url", string(args))
				}
				address = "https://control.example"
			} else if !strings.Contains(string(args), "--server-url\n"+strings.TrimRight(address, "/")+"\n") {
				t.Fatal("内网地址未传入独立安装任务", string(args))
			}
			request, err := os.ReadFile(curlArgs)
			if err != nil || !strings.Contains(string(request), strings.TrimRight(address, "/")+"/api/host/v1/releases/v1/arm64/installer\n") {
				t.Fatal("未从指定地址下载安装器", string(request), err)
			}
		})
	}
}

func TestServerURLRejectsInvalidOrigins(t *testing.T) {
	service := NewService(nil).WithInstallation("https://control.example", fixture(t), "v1").WithLicense(installationLicense(true))
	router := chi.NewRouter()
	service.Register(router)
	for _, address := range []string{"ftp://server.example", "http://user:pass@server.example", "http://server.example/path", "http://server.example?x=1", "http://server.example#fragment", "http://server.example\n"} {
		query := url.Values{"version": {"v1"}, "server_url": {address}}
		response := call(router, "GET", "/api/host/v1/install.sh?"+query.Encode(), nil)
		if response.Code != 400 {
			t.Fatalf("接受非法 server_url %q：%d", address, response.Code)
		}
	}
}
