package envimage

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"slices"
	"testing"
)

func TestDockerPullIntegration(t *testing.T) {
	if os.Getenv("MONKEYAI_REGISTRY_DOCKER_TEST") != "1" {
		t.Skip("仅在一次性 Docker-in-Docker 环境验证")
	}
	if _, err := os.Stat("/monkeyai-docker-test"); err != nil {
		t.Fatal("缺少隔离测试标记")
	}
	for _, secure := range []bool{false, true} {
		name := "http"
		if secure {
			name = "https"
		}
		t.Run(name, func(t *testing.T) { testDockerPull(t, secure) })
	}
}

func testDockerPull(t *testing.T, secure bool) {
	protocol := "http"
	if secure {
		protocol = "https"
	}
	service, err := New(t.Context(), t.TempDir(), protocol+"://registry.example")
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	service.WithAuthorize(func(r *http.Request) bool {
		user, password, ok := r.BasicAuth()
		return ok && user == "host" && password == "temporary-test-credential"
	})
	server := httptest.NewUnstartedServer(service)
	if address := os.Getenv("MONKEYAI_HTTP_REGISTRY_LISTEN"); !secure && address != "" {
		_ = server.Listener.Close()
		server.Listener, err = net.Listen("tcp", address)
		if err != nil {
			t.Fatal(err)
		}
	}
	if secure {
		server.StartTLS()
	} else {
		server.Start()
	}
	defer server.Close()
	address, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	service.host = address.Host
	index := testIndex(t)
	digest, _ := index.Digest()
	source := "unreachable.invalid/environment@" + digest.String()
	if err := service.pushIndex(t.Context(), source, index); err != nil {
		t.Fatal(err)
	}
	if err := service.selectDefault(source); err != nil {
		t.Fatal(err)
	}
	reference, expectedDigest, err := service.Default(t.Context(), runtime.GOARCH)
	if err != nil || expectedDigest != digest.String() {
		t.Fatal(reference, expectedDigest, err)
	}
	pinned, err := service.Resolve(t.Context(), source, runtime.GOARCH)
	if err != nil {
		t.Fatal(err)
	}
	auth, _ := json.Marshal(map[string]string{"username": "host", "password": "temporary-test-credential", "serveraddress": service.host})
	client := &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", "/var/run/docker.sock")
	}}}
	defer client.CloseIdleConnections()
	request, _ := http.NewRequestWithContext(t.Context(), "POST", "http://docker/v1.47/images/create?fromImage="+url.QueryEscape(reference)+"&platform=linux/"+runtime.GOARCH, nil)
	request.Header.Set("X-Registry-Auth", base64.URLEncoding.EncodeToString(auth))
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		raw, _ := io.ReadAll(response.Body)
		t.Fatal(response.StatusCode, string(raw))
	}
	decoder := json.NewDecoder(response.Body)
	for {
		var event struct{ Error string }
		if err := decoder.Decode(&event); err == io.EOF {
			break
		} else if err != nil {
			t.Fatal(err)
		}
		if event.Error != "" {
			t.Fatal(event.Error)
		}
	}
	output, err := exec.Command("docker", "image", "inspect", reference).Output()
	if err != nil {
		t.Fatal(err)
	}
	var images []struct {
		RepoDigests  []string
		Architecture string
	}
	if json.Unmarshal(output, &images) != nil || len(images) != 1 || !slices.Contains(images[0].RepoDigests, pinned) || images[0].Architecture != runtime.GOARCH {
		t.Fatal("真实Docker未保留仓库摘要和架构", string(output))
	}
	_ = exec.Command("docker", "image", "rm", reference).Run()
	t.Log("真实Docker使用X-Registry-Auth按可读版本tag拉取，独立摘要与架构校验通过", reference)
}
